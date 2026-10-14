import type { SupabaseClient } from '@supabase/supabase-js';
import { recordBusinessEvent } from '@/lib/audit/businessEvents';
import { sendTenantInviteEmail } from '@/lib/integrations/email-service';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  InvitationError,
  assertInvitationDomainAllowed,
  assertInvitationRoleAllowed,
  generateInvitationToken,
  normalizeInvitationEmail,
} from './tenant-invitations';

export type InvitationSource = 'dashboard' | 'owner_api' | 'manager_api' | 'whatsapp_v2';

export type IssueTenantInvitationInput = {
  tenantId: string;
  actorUserId: string;
  actorRole: 'owner' | 'manager';
  actorEmail: string | null;
  invitedEmail: string;
  invitedRole: 'manager' | 'staff';
  publicOrigin: string;
  source: InvitationSource;
};

type TenantInvitationSettings = {
  allowedInviterRoles?: string[];
  allowInvitesFromStaffPage?: boolean;
  disablePublicInvites?: boolean;
  allowedEmailDomains?: string[];
};

export type InvitationStore = {
  getTenantPolicy(tenantId: string): Promise<{
    name: string | null;
    settings: TenantInvitationSettings;
  }>;
  hasAuthenticatedMembership(tenantId: string, email: string): Promise<boolean>;
  revokePending(tenantId: string, email: string, revokedAt: string): Promise<void>;
  createInvitation(input: {
    tenantId: string;
    email: string;
    role: 'manager' | 'staff';
    tokenHash: string;
    invitedBy: string;
    expiresAt: string;
  }): Promise<{ id: string; expiresAt: string }>;
  revokeInvitation(invitationId: string): Promise<void>;
};

export class InvitationIssueError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    options?: { cause?: unknown }
  ) {
    super(code, options);
    this.name = 'InvitationIssueError';
  }
}

function assertNoError(error: { message?: string } | null, operation: string): void {
  if (error) {
    throw new InvitationIssueError('invite_database_error', 500, {
      cause: new Error(`${operation}: ${error.message ?? 'database error'}`),
    });
  }
}

export function createSupabaseInvitationStore(
  admin: SupabaseClient = createSupabaseAdminClient() as unknown as SupabaseClient
): InvitationStore {
  return {
    async getTenantPolicy(tenantId) {
      const { data, error } = await admin
        .from('tenants')
        .select('name, settings')
        .eq('id', tenantId)
        .single();
      assertNoError(error, 'load tenant invitation policy');
      if (!data) throw new InvitationIssueError('invite_tenant_not_found', 404);
      return {
        name: typeof data.name === 'string' ? data.name : null,
        settings: (data.settings ?? {}) as TenantInvitationSettings,
      };
    },

    async hasAuthenticatedMembership(tenantId, email) {
      const { data, error } = await admin
        .from('tenant_users')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('email', email)
        .not('user_id', 'is', null)
        .limit(1)
        .maybeSingle();
      assertNoError(error, 'check tenant membership');
      return Boolean(data);
    },

    async revokePending(tenantId, email, revokedAt) {
      const { error } = await admin
        .from('tenant_invitations')
        .update({ revoked_at: revokedAt })
        .eq('tenant_id', tenantId)
        .eq('email', email)
        .is('accepted_at', null)
        .is('revoked_at', null);
      assertNoError(error, 'revoke pending invitation');
    },

    async createInvitation(input) {
      const { data, error } = await admin
        .from('tenant_invitations')
        .insert({
          tenant_id: input.tenantId,
          email: input.email,
          role: input.role,
          token_hash: input.tokenHash,
          invited_by: input.invitedBy,
          expires_at: input.expiresAt,
        })
        .select('id, expires_at')
        .single();
      assertNoError(error, 'create tenant invitation');
      if (!data) throw new InvitationIssueError('invite_database_error', 500);
      return { id: String(data.id), expiresAt: String(data.expires_at) };
    },

    async revokeInvitation(invitationId) {
      const { error } = await admin
        .from('tenant_invitations')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', invitationId)
        .is('accepted_at', null);
      assertNoError(error, 'revoke invitation');
    },
  };
}

function validatePublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvitationIssueError('invite_invalid_origin', 500);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.origin !== value.replace(/\/$/, '') ||
    url.username ||
    url.password
  ) {
    throw new InvitationIssueError('invite_invalid_origin', 500);
  }
  return url.origin;
}

function safeIssueError(error: unknown): InvitationIssueError {
  if (error instanceof InvitationIssueError) return error;
  if (error instanceof InvitationError) {
    return new InvitationIssueError(error.code, 403, { cause: error });
  }
  return new InvitationIssueError('invite_database_error', 500, { cause: error });
}

export async function issueTenantInvitation(
  input: IssueTenantInvitationInput,
  dependencies: {
    store?: InvitationStore;
    sendInvite?: typeof sendTenantInviteEmail;
    recordEvent?: (event: {
      tenantId: string;
      actorUserId: string;
      invitationId: string;
      invitedRole: 'manager' | 'staff';
      source: InvitationSource;
      outcome: 'sent' | 'delivery_failed';
    }) => Promise<void>;
    now?: () => Date;
  } = {}
): Promise<{ ok: true; email_sent: true; expires_at: string }> {
  const store = dependencies.store ?? createSupabaseInvitationStore();
  const sendInvite = dependencies.sendInvite ?? sendTenantInviteEmail;
  const now = dependencies.now?.() ?? new Date();
  const email = normalizeInvitationEmail(input.invitedEmail);

  try {
    assertInvitationRoleAllowed(input.actorRole, input.invitedRole);
    const tenant = await store.getTenantPolicy(input.tenantId);
    const settings = tenant.settings ?? {};
    const allowedInviters = (settings.allowedInviterRoles ?? ['owner', 'manager']).map((role) =>
      String(role).toLowerCase()
    );
    if (
      settings.disablePublicInvites === true ||
      settings.allowInvitesFromStaffPage === false ||
      !allowedInviters.includes(input.actorRole)
    ) {
      throw new InvitationIssueError('invite_disabled', 403);
    }

    try {
      assertInvitationDomainAllowed(email, settings.allowedEmailDomains ?? []);
    } catch (error) {
      throw new InvitationIssueError('invite_domain_forbidden', 403, { cause: error });
    }

    if (await store.hasAuthenticatedMembership(input.tenantId, email)) {
      throw new InvitationIssueError('invite_already_member', 409);
    }

    const publicOrigin = validatePublicOrigin(input.publicOrigin);
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { rawToken, tokenHash } = generateInvitationToken();

    await store.revokePending(input.tenantId, email, now.toISOString());
    const invitation = await store.createInvitation({
      tenantId: input.tenantId,
      email,
      role: input.invitedRole,
      tokenHash,
      invitedBy: input.actorUserId,
      expiresAt,
    });
    const inviteUrl = new URL('/api/invitations/open', publicOrigin);
    inviteUrl.searchParams.set('token', rawToken);

    let delivery: Awaited<ReturnType<typeof sendTenantInviteEmail>>;
    try {
      delivery = await sendInvite({
        to: email,
        inviteUrl: inviteUrl.toString(),
        invitedRole: input.invitedRole,
        inviterEmail: input.actorEmail,
        tenantName: tenant.name,
      });
    } catch (error) {
      await store.revokeInvitation(invitation.id).catch(() => undefined);
      await dependencies.recordEvent?.({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        invitationId: invitation.id,
        invitedRole: input.invitedRole,
        source: input.source,
        outcome: 'delivery_failed',
      });
      throw new InvitationIssueError('invite_delivery_failed', 502, { cause: error });
    }

    if (!delivery.success) {
      await store.revokeInvitation(invitation.id).catch(() => undefined);
      await dependencies.recordEvent?.({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        invitationId: invitation.id,
        invitedRole: input.invitedRole,
        source: input.source,
        outcome: 'delivery_failed',
      });
      throw new InvitationIssueError('invite_delivery_failed', 502);
    }

    const event = {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      invitationId: invitation.id,
      invitedRole: input.invitedRole,
      source: input.source,
      outcome: 'sent' as const,
    };
    if (dependencies.recordEvent) {
      await dependencies.recordEvent(event);
    } else {
      const auditAdmin = createSupabaseAdminClient() as unknown as SupabaseClient;
      await recordBusinessEvent(auditAdmin, {
        tenantId: event.tenantId,
        actorType: 'user',
        actorId: event.actorUserId,
        action: 'tenant_invitation_sent',
        entityType: 'tenant_invitation',
        entityId: event.invitationId,
        source: event.source === 'whatsapp_v2' ? 'whatsapp' : event.source === 'dashboard' ? 'dashboard' : 'api',
        metadata: { invited_role: event.invitedRole, outcome: event.outcome },
      });
    }

    return { ok: true, email_sent: true, expires_at: invitation.expiresAt };
  } catch (error) {
    throw safeIssueError(error);
  }
}
