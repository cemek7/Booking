import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { auditSuperadminAction } from '@/lib/enhanced-rbac';
import { z } from 'zod';

const SettingsSchemaBase = z.object({
  displayName: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  brandingColor: z.string().regex(/^#?[0-9a-fA-F]{3,8}$/).optional(),
  tone: z.string().min(1).optional(),
  styleGuidelines: z.string().min(1).optional(),
  voiceParameters: z.record(z.any()).optional(),
  samplePhrases: z.array(z.string().min(1)).optional(),
  brandTagline: z.string().optional(),
  greeting: z.string().optional(),
  signature: z.string().optional(),
  requireDeposit: z.boolean().optional(),
  services: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    duration: z.number().int().min(0).optional(),
    price: z.number().min(0).optional(),
    category: z.string().optional(),
    is_active: z.boolean().optional(),
    skills: z.array(z.string()).optional()
  })).optional(),
  defaultCurrency: z.string().length(3).optional(),
  depositPercent: z.number().min(0).max(100).optional(),
  cancellationPolicy: z.string().optional(),
  businessHours: z.record(z.object({ open: z.string().optional(), close: z.string().optional(), closed: z.boolean().optional() })).optional(),
  staffAssignmentStrategy: z.enum(['round_robin','preferred','skill_based']).optional(),
  allowOverbooking: z.boolean().optional(),
  reminderLead: z.number().int().min(0).optional(),
  secondReminderLead: z.number().int().min(0).optional(),
  defaultChannels: z.array(z.string()).optional(),
  optInPolicy: z.enum(['implicit','explicit']).optional(),
  notifyFrom: z.string().email().optional(),
  customReminderMessage: z.string().optional(),
  mfaRequired: z.boolean().optional(),
  sessionTimeout: z.number().int().min(1).optional(),
  allowedEmailDomains: z.array(z.string()).optional(),
  disablePublicInvites: z.boolean().optional(),
  allowedInviterRoles: z.array(z.enum(['owner','manager','staff'])).optional(),
  allowInvitesFromStaffPage: z.boolean().optional(),
  apiKeyPresent: z.boolean().optional(),
  apiKeyHash: z.string().optional(),
  apiKeySalt: z.string().optional(),
  whatsappNumber: z.string().optional(),
  templateNamespace: z.string().optional(),
  integrationStatus: z.string().optional(),
  evolutionInstance: z.string().optional(),
  evolutionApiKey: z.string().optional(),
  whatsappDefaultDelaySeconds: z.number().int().min(0).optional(),
  whatsappLinkPreview: z.boolean().optional()
}).partial();

const SettingsSchema = SettingsSchemaBase.superRefine((val, ctx) => {
  if (val.requireDeposit && (val.depositPercent === undefined || val.depositPercent <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'depositPercent is required when requireDeposit is true and must be > 0', path: ['depositPercent'] });
  }
  if (val.businessHours) {
    for (const [day, hours] of Object.entries(val.businessHours)) {
      if (hours && hours.closed) continue;
      const open = hours?.open; const close = hours?.close;
      if ((open && !close) || (!open && close)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Both open and close required when day is not closed', path: ['businessHours', day] });
      }
      if (open && close) {
        if (open >= close) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Open time must be earlier than close time', path: ['businessHours', day] });
        }
      }
    }
  }
  if ((val.tone || val.styleGuidelines) && (!val.samplePhrases || val.samplePhrases.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Add at least one sample phrase when specifying tone or style guidelines', path: ['samplePhrases'] });
  }
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const { data, error } = await ctx.supabase
      .from('tenants')
      .select('settings, metadata, timezone')
      .eq('id', tenantId)
      .single();

    const resolved: Record<string, unknown> = {};
    if (!error) {
      const row = (data ?? {}) as { settings?: Record<string, unknown> | null; metadata?: Record<string, unknown> | null; timezone?: string | null };
      if (row.settings && typeof row.settings === 'object') Object.assign(resolved, row.settings);
      else if (row.metadata && typeof row.metadata === 'object') {
        const ui = (row.metadata['ui_settings'] ?? null) as unknown;
        if (ui && typeof ui === 'object') Object.assign(resolved, ui as Record<string, unknown>);
      }
      if (row.timezone && typeof row.timezone === 'string') (resolved as Record<string, unknown>)['timezone'] = row.timezone;
    } else {
      const msg = error.message || '';
      if (!msg.includes('column') || !msg.includes('settings')) {
        throw ApiErrorFactory.databaseError(error);
      }
    }
    if (!Array.isArray(resolved.allowedInviterRoles)) {
      resolved.allowedInviterRoles = ['owner','manager'];
    }
    if (typeof resolved.allowInvitesFromStaffPage !== 'boolean') {
      resolved.allowInvitesFromStaffPage = true;
    }
    return resolved;
  },
  'GET',
  { auth: true }
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const patch = await parseJsonBody<Record<string, unknown>>(ctx.request);

    const parsed = SettingsSchema.safeParse(patch);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join('.') || '_',
            issue.message
          ])
        )
      );
    }
    const patchObj = parsed.data as Record<string, unknown>;

    // Audit superadmin actions
    if (ctx.user!.role === 'superadmin') {
      await auditSuperadminAction(
        ctx.supabase,
        ctx.user!.id,
        'UPDATE_TENANT_SETTINGS',
        tenantId,
        undefined,
        'tenant_settings',
        {
          tenantId,
          settingsUpdate: patchObj
        }
      );
    }

    const { data: current, error: fetchErr } = await ctx.supabase
      .from('tenants')
      .select('settings, metadata')
      .eq('id', tenantId)
      .single();

    // If settings column missing, write into metadata.ui_settings as a fallback
    if (fetchErr && (fetchErr.message || '').includes('settings')) {
      const rowMetaWrap = (current ?? {}) as { metadata?: Record<string, unknown> | null };
      const existingMeta: Record<string, unknown> = rowMetaWrap.metadata && typeof rowMetaWrap.metadata === 'object' ? rowMetaWrap.metadata : {};
      const prevUi = (existingMeta['ui_settings'] && typeof existingMeta['ui_settings'] === 'object') ? existingMeta['ui_settings'] as Record<string, unknown> : {};
      const mergedUi: Record<string, unknown> = { ...prevUi, ...patchObj };
      const nextMeta = { ...existingMeta, ui_settings: mergedUi };
      const { error: upMetaErr } = await ctx.supabase
        .from('tenants')
        .update({ metadata: nextMeta })
        .eq('id', tenantId);
      if (upMetaErr) throw ApiErrorFactory.databaseError(upMetaErr);
      return mergedUi;
    }

    if (fetchErr) throw ApiErrorFactory.databaseError(fetchErr);

    const currWrap = (current ?? {}) as { settings?: Record<string, unknown> | null };
    const currSettings: Record<string, unknown> = currWrap.settings && typeof currWrap.settings === 'object' ? currWrap.settings : {};
    const merged: Record<string, unknown> = { ...currSettings, ...patchObj };

    const { error: updateErr } = await ctx.supabase
      .from('tenants')
      .update({ settings: merged })
      .eq('id', tenantId);

    if (updateErr) throw ApiErrorFactory.databaseError(updateErr);
    return merged;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);
