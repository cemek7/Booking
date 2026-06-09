/**
 * Owner Onboarding Flow (5-step chat)
 *
 * Guides a new business owner through setup entirely via WhatsApp chat.
 * All free-form parsing is done by L2 Flash-Lite — no templates to fill in.
 *
 * State is stored in whatsapp_conversations.flow_data:
 *   { onboarding_step: 0-5, partial_tenant: {...}, partial_services: [...] }
 *
 * Steps:
 *   0 → 1: Greeting + business type/location
 *   1 → 2: Services list
 *   2 → 3: Team (solo or named staff)
 *   3 → 4: Working hours
 *   4 → 5: Activation (generate routing_code + QR + send link)
 */

import { createClient } from '@supabase/supabase-js';
import { callGoogleAI } from '@/lib/google-ai';
import { updateConversation, ConvState, ConvChannel } from '../conversationState';
import { generateRoutingCode } from '../identityResolver';
import { estimatePromptTokens, withTenantWalletSpend } from '@/lib/billing/ai-wallet';
import type { RuleMatch } from '@/lib/ai/rulesEngine';
import type { AIResponse } from '../actionValidator';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FLASH_LITE_MODEL = 'gemini-2.0-flash-lite';

type LLMChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
    text?: string | null;
  }>;
};

function getChatContent(result: LLMChatCompletionResponse | null | undefined): string {
  return String(result?.choices?.[0]?.message?.content ?? result?.choices?.[0]?.text ?? '');
}

// Vertical presets — used to seed tenants.settings on business type detection
const VERTICAL_PRESETS: Record<string, Record<string, string>> = {
  beauty: { staff_title: 'stylist', staff_title_plural: 'stylists', booking_noun: 'appointment', session_noun: 'styling session', ai_personality: 'warm and expressive' },
  fitness: { staff_title: 'trainer', staff_title_plural: 'trainers', booking_noun: 'booking', session_noun: 'session', ai_personality: 'energetic and motivating' },
  medical: { staff_title: 'doctor', staff_title_plural: 'doctors', booking_noun: 'appointment', session_noun: 'consultation', ai_personality: 'professional and calm' },
  education: { staff_title: 'tutor', staff_title_plural: 'tutors', booking_noun: 'booking', session_noun: 'lesson', ai_personality: 'encouraging' },
  automotive: { staff_title: 'technician', staff_title_plural: 'technicians', booking_noun: 'appointment', session_noun: 'service', ai_personality: 'efficient and clear' },
  hospitality: { staff_title: 'staff', staff_title_plural: 'staff', booking_noun: 'reservation', session_noun: 'visit', ai_personality: 'courteous' },
  legal: { staff_title: 'counsel', staff_title_plural: 'counsels', booking_noun: 'appointment', session_noun: 'consultation', ai_personality: 'formal and precise' },
  general: { staff_title: 'staff', staff_title_plural: 'staff members', booking_noun: 'booking', session_noun: 'session', ai_personality: 'friendly and professional' },
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function handleOnboarding(
  phone: string,
  tenantId: string | null,
  message: string,
  conv: ConvState | null
): Promise<string> {
  const step = conv?.flow_data?.onboarding_step ?? 0;

  switch (step) {
    case 0: return startOnboarding(phone);
    case 1: return handleStep1(phone, tenantId, message, conv!);
    case 2: return handleStep2(phone, tenantId, message, conv!);
    case 3: return handleStep3(phone, tenantId, message, conv!);
    case 4: return handleStep4(phone, tenantId, message, conv!);
    default: return 'Your setup is complete! Just message me any time to manage your business.';
  }
}

// ─── Step 0: Initial greeting ─────────────────────────────────────────────────

async function startOnboarding(phone: string): Promise<string> {
  return `Hi! I'm Booka — I help businesses manage bookings on WhatsApp. 🎉

What kind of business do you run and where are you located?

For example: "Hair salon in Yaba Lagos" or "Auto mechanic workshop, Abuja"`;
}

// ─── Step 1: Identity + vertical detection ────────────────────────────────────

async function handleStep1(
  phone: string,
  tenantId: string | null,
  message: string,
  conv: ConvState
): Promise<string> {
  const parsePrompt = `
Extract business information from this message: "${message}"

Return JSON only:
{
  "business_name": "extracted name or null",
  "vertical": "beauty | fitness | medical | education | automotive | hospitality | legal | general",
  "location": "city/area or null"
}`;

  let parsed: { business_name: string | null; vertical: string; location: string | null };
  try {
    const result = await withTenantWalletSpend(
      supabaseAdmin,
      tenantId,
      {
        estimatedTokens: estimatePromptTokens(parsePrompt.length),
        provider: 'google_ai',
        model: FLASH_LITE_MODEL,
        requestId: `onboarding:step1:${phone}:${Date.now()}`,
        description: 'Owner onboarding business parsing',
        metadata: {
          onboarding_step: 1,
          phone,
        },
      },
      () => callGoogleAI([{ role: 'user', content: parsePrompt }], FLASH_LITE_MODEL)
    );
    const text = getChatContent(result.json as LLMChatCompletionResponse);
    parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    return 'Sorry, I couldn\'t understand that. Could you tell me your business name, type, and location? E.g. "Glamour Hair Studio, beauty salon in Yaba Lagos"';
  }

  const vertical = parsed.vertical ?? 'general';
  const preset = VERTICAL_PRESETS[vertical] ?? VERTICAL_PRESETS.general;
  const businessName = parsed.business_name ?? 'My Business';

  // Create or update the tenant
  let resolvedTenantId = tenantId;
  if (!resolvedTenantId) {
    const { data: newTenant } = await supabaseAdmin
      .from('tenants')
      .insert({
        name: businessName,
        location: parsed.location,
        v2_enabled: false, // enabled at step 5
        settings: { vertical, ...preset },
      })
      .select('id')
      .single();
    resolvedTenantId = newTenant?.id ?? null;

    // Create tenant_users row for the owner (WA-native: user_id=NULL)
    if (resolvedTenantId) {
      await supabaseAdmin.from('tenant_users').insert({
        tenant_id: resolvedTenantId,
        role: 'owner',
        phone,
        services_all: true,
      });
    }
  }

  // Update conversation with new tenantId and step
  if (resolvedTenantId) {
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({
        tenant_id: resolvedTenantId,
        role: 'owner',
        current_flow: 'onboarding',
        flow_step: 1,
        flow_data: {
          ...conv.flow_data,
          onboarding_step: 2,
          tenant_id: resolvedTenantId,
        },
      })
      .eq('phone_number', phone)
      .eq('id', conv.id);
  }

  const staffLabel = preset.staff_title ?? 'staff';
  const serviceNoun = vertical === 'education' ? 'subjects or courses you offer? Include your rates per session' :
    vertical === 'medical' ? 'consultations or treatments you offer? Include consultation fees' :
    vertical === 'automotive' ? 'services you offer? E.g.: Oil change 8000, Full service 25000' :
    'services you offer? Include prices. E.g.: Braids 5000, Frontal 15000';

  return `Great! I've set up *${businessName}* 🎉

Now, what ${serviceNoun}?

You can list them like:
  Braids — 5,000
  Frontal — 15,000
  Or just type them naturally and I'll sort it out.`;
}

// ─── Step 2: Services ─────────────────────────────────────────────────────────

async function handleStep2(
  phone: string,
  tenantId: string | null,
  message: string,
  conv: ConvState
): Promise<string> {
  const resolvedTenantId = tenantId ?? conv.flow_data?.tenant_id;
  if (!resolvedTenantId) return 'Something went wrong. Please start over by saying "hi".';

  const parsePrompt = `
Parse this services list into structured data: "${message}"

Return JSON only — array of objects:
[
  { "name": "service name", "price": 5000, "duration_minutes": 60 }
]
If duration is not mentioned, default to 60.
Prices are in local currency (no currency symbol needed).`;

  let services: Array<{ name: string; price: number; duration_minutes: number }> = [];
  try {
    const result = await withTenantWalletSpend(
      supabaseAdmin,
      resolvedTenantId,
      {
        estimatedTokens: estimatePromptTokens(parsePrompt.length),
        provider: 'google_ai',
        model: FLASH_LITE_MODEL,
        requestId: `onboarding:step2:${resolvedTenantId}:${Date.now()}`,
        description: 'Owner onboarding service parsing',
        metadata: {
          onboarding_step: 2,
          tenant_id: resolvedTenantId,
          phone,
        },
      },
      () => callGoogleAI([{ role: 'user', content: parsePrompt }], FLASH_LITE_MODEL)
    );
    const text = getChatContent(result.json as LLMChatCompletionResponse);
    services = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    return 'I had trouble reading that list. Please try again. E.g.:\n  Braids — 5000\n  Frontal — 15000';
  }

  if (!services.length) {
    return 'I couldn\'t find any services in that message. Please list your services with prices, one per line.';
  }

  // Insert services
  const rows = services.map((s) => ({
    tenant_id: resolvedTenantId,
    name: s.name,
    price_cents: Math.round(s.price * 100),
    duration_minutes: s.duration_minutes ?? 60,
    is_active: true,
  }));

  await supabaseAdmin.from('services').insert(rows);

  // Advance step — use conv.external_id + conv.channel so the correct row is updated.
  const convChannel2: ConvChannel = conv.channel ?? 'whatsapp';
  const convExternalId2 = conv.external_id ?? phone;
  await updateConversation(convExternalId2, resolvedTenantId, {
    flow_step: 2,
    flow_data: { ...conv.flow_data, onboarding_step: 3 },
  }, convChannel2);

  const serviceLines = services.map((s) => `  • ${s.name} — ₦${s.price.toLocaleString()}`).join('\n');
  const { data: tenantData } = await supabaseAdmin.from('tenants').select('settings').eq('id', resolvedTenantId).single();
  const staffTitle = tenantData?.settings?.staff_title ?? 'staff';
  const staffTitleQuestion = staffTitle === 'stylist' ? 'Are you the only stylist, or do you have a team?' :
    staffTitle === 'doctor' ? 'Are you the only doctor, or are there other consultants?' :
    staffTitle === 'technician' ? 'Do you work alone or do you have technicians on your team?' :
    `Are you the only ${staffTitle}, or do you have a team?`;

  return `Got it! Here's what I've added:\n${serviceLines}\n\n${staffTitleQuestion}\n\nReply *solo* if it's just you, or tell me your team members and their specialties.`;
}

// ─── Step 3: Team setup ───────────────────────────────────────────────────────

async function handleStep3(
  phone: string,
  tenantId: string | null,
  message: string,
  conv: ConvState
): Promise<string> {
  const resolvedTenantId = tenantId ?? conv.flow_data?.tenant_id;
  if (!resolvedTenantId) return 'Something went wrong. Please start over.';

  const isSolo = /^(solo|just me|only me|i work alone|by myself|no team)/i.test(message.trim());

  if (isSolo) {
    // Solo operator — update the owner's tenant_user record with services_all=TRUE
    await supabaseAdmin
      .from('tenant_users')
      .update({ services_all: true })
      .eq('tenant_id', resolvedTenantId)
      .eq('phone', phone);
  } else {
    // Parse team members
    const parsePrompt = `
Parse this team list: "${message}"

Return JSON — array of staff:
[
  { "name": "Adaeze", "phone": "+2348012345678 or null", "specialties": ["Braids", "Twists"] }
]
Phone is optional — only include if explicitly mentioned.`;

    try {
      const result = await withTenantWalletSpend(
        supabaseAdmin,
        resolvedTenantId,
        {
          estimatedTokens: estimatePromptTokens(parsePrompt.length),
          provider: 'google_ai',
          model: FLASH_LITE_MODEL,
          requestId: `onboarding:step3:${resolvedTenantId}:${Date.now()}`,
          description: 'Owner onboarding team parsing',
          metadata: {
            onboarding_step: 3,
            tenant_id: resolvedTenantId,
            phone,
          },
        },
        () => callGoogleAI([{ role: 'user', content: parsePrompt }], FLASH_LITE_MODEL)
      );
      const text = getChatContent(result.json as LLMChatCompletionResponse);
      const staffList: Array<{ name: string; phone?: string; specialties?: string[] }> =
        JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      for (const member of staffList) {
        await supabaseAdmin.from('tenant_users').insert({
          tenant_id: resolvedTenantId,
          role: 'staff',
          phone: member.phone ?? null,
          services_all: !member.specialties?.length,
        });
      }
    } catch {
      return 'I had trouble reading the team list. Try: "Adaeze does braids and twists, Chioma does locs and weaves"';
    }
  }

  const convChannel3: ConvChannel = conv.channel ?? 'whatsapp';
  const convExternalId3 = conv.external_id ?? phone;
  await updateConversation(convExternalId3, resolvedTenantId, {
    flow_step: 3,
    flow_data: { ...conv.flow_data, onboarding_step: 4 },
  }, convChannel3);

  return `Perfect! What are your working hours?\n\nExamples:\n  "Mon–Fri 9am–7pm, Sat 8am–5pm, closed Sunday"\n  "Every day 8am to 8pm"\n  "Weekdays 10–6, weekends 9–4"`;
}

// ─── Step 4: Hours ────────────────────────────────────────────────────────────

async function handleStep4(
  phone: string,
  tenantId: string | null,
  message: string,
  conv: ConvState
): Promise<string> {
  const resolvedTenantId = tenantId ?? conv.flow_data?.tenant_id;
  if (!resolvedTenantId) return 'Something went wrong. Please start over.';

  const parsePrompt = `
Parse working hours from: "${message}"

Return JSON — array per day (0=Sunday, 6=Saturday):
[
  { "day_of_week": 1, "start_time": "09:00", "end_time": "19:00" }
]
Only include days that are open.`;

  let schedules: Array<{ day_of_week: number; start_time: string; end_time: string }> = [];
  try {
    const result = await withTenantWalletSpend(
      supabaseAdmin,
      resolvedTenantId,
      {
        estimatedTokens: estimatePromptTokens(parsePrompt.length),
        provider: 'google_ai',
        model: FLASH_LITE_MODEL,
        requestId: `onboarding:step4:${resolvedTenantId}:${Date.now()}`,
        description: 'Owner onboarding hours parsing',
        metadata: {
          onboarding_step: 4,
          tenant_id: resolvedTenantId,
          phone,
        },
      },
      () => callGoogleAI([{ role: 'user', content: parsePrompt }], FLASH_LITE_MODEL)
    );
    const text = getChatContent(result.json as LLMChatCompletionResponse);
    schedules = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    return 'I had trouble reading those hours. Try: "Mon–Fri 9am–7pm, Sat 8am–5pm"';
  }

  // Find the owner's tenant_user record to link schedules
  const { data: ownerUser } = await supabaseAdmin
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', resolvedTenantId)
    .eq('phone', phone)
    .maybeSingle();

  if (ownerUser) {
    const rows = schedules.map((s) => ({
      tenant_id: resolvedTenantId,
      tenant_user_id: ownerUser.id,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      is_active: true,
    }));
    await supabaseAdmin.from('staff_schedules').insert(rows);
  }

  // ── Activation ────────────────────────────────────────────────────────────
  const { data: tenantData } = await supabaseAdmin
    .from('tenants')
    .select('name, settings')
    .eq('id', resolvedTenantId)
    .single();

  const routingCode = await generateRoutingCode(tenantData?.name ?? 'BIZ');

  await supabaseAdmin
    .from('tenants')
    .update({ routing_code: routingCode, v2_enabled: true })
    .eq('id', resolvedTenantId);

  const convChannel4: ConvChannel = conv.channel ?? 'whatsapp';
  const convExternalId4 = conv.external_id ?? phone;
  await updateConversation(convExternalId4, resolvedTenantId, {
    current_flow: 'managing',
    flow_step: 0,
    flow_data: { onboarding_step: 5 },
  }, convChannel4);

  const waNumber = process.env.EVOLUTION_DEFAULT_PHONE ?? '2348000000000';
  const bookingLink = `https://wa.me/${waNumber}?text=${routingCode}`;
  const businessName = tenantData?.name ?? 'your business';
  const bookingNoun = tenantData?.settings?.booking_noun ?? 'booking';

  return `You're live! 🚀\n\n*${businessName}* is now on Booka.\n\nYour customers can book by:\n  1. Tapping this link: ${bookingLink}\n  2. Texting *${routingCode}* to this number\n\nShare it on Instagram, WhatsApp broadcast, or print it as a QR code.\n\nTo manage your business, just message me any time:\n  • "Who's booked tomorrow?"\n  • "Block Thursday afternoon"\n  • "Change braids price to 6000"\n  • "How was this week?"\n\nYou're all set! 🎉`;
}
