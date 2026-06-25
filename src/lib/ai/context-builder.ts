import type { ConvState } from '@/lib/whatsapp/v2/conversationState';
import type { GroundingResult } from './grounding-service';

export function buildFrontDeskPrompt(input: {
  grounding: GroundingResult;
  message: string;
  conv: ConvState;
  userRole: 'owner' | 'customer';
  retryContext?: string | null;
}): string {
  const { grounding, message, conv, userRole, retryContext } = input;
  const tenant = grounding.tenant;
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  const staffTitle = String(settings.staff_title ?? 'staff');
  const staffTitlePlural = String(settings.staff_title_plural ?? 'staff members');
  const bookingNoun = String(settings.booking_noun ?? 'booking');
  const sessionNoun = String(settings.session_noun ?? 'session');
  const personality = String(settings.ai_personality ?? 'friendly and professional');
  const customInstructions = String(settings.custom_ai_instructions ?? '');

  const servicesBlock = grounding.services.length > 0
    ? grounding.services
        .map((service) => `- ${service.name}: ₦${Math.round((service.price_cents ?? 0) / 100).toLocaleString()} (${service.duration_minutes ?? 60}min)`)
        .join('\n')
    : '- No active services configured';

  const staffBlock = grounding.staff.length > 0
    ? grounding.staff
        .map((staff) => `- ${staff.name ?? staff.phone ?? staff.id}`)
        .join('\n')
    : '- No active staff configured';

  const slotBlock = grounding.availableSlots.length > 0
    ? grounding.availableSlots
        .map((entry) => `- ${entry.staffId}: ${entry.slots.join(', ')}`)
        .join('\n')
    : '- No precomputed slots available for this request';

  const ownerBlock = userRole === 'owner'
    ? `Owner summary:\n${formatOwnerSummary(grounding.ownerSummary)}\n`
    : '';

  const retryBlock = retryContext
    ? `Previous validation failed: ${retryContext}\nCorrect the action and try again.\n`
    : '';

  return `You are the AI front desk for ${tenant?.name ?? 'this business'}.

Intent:
- ${grounding.route.intent}
- Confidence: ${grounding.route.confidence}
- Routed by: ${grounding.route.source}

Business context:
- Timezone: ${grounding.timezone}
- Buffer: ${tenant?.buffer_minutes ?? 15} minutes
- Refer to team members as "${staffTitle}" (plural "${staffTitlePlural}")
- Call appointments a "${bookingNoun}"
- Call visits a "${sessionNoun}"
- Tone: ${personality}
${customInstructions}

Services:
${servicesBlock}

Staff:
${staffBlock}

Available slots:
${slotBlock}

${ownerBlock}Conversation state:
- Flow: ${conv.current_flow}
- Step: ${conv.flow_step}
- Booking in progress: ${JSON.stringify(conv.flow_data?.booking_in_progress ?? null)}

${retryBlock}Customer message:
"${message}"

Respond ONLY with valid JSON:
{
  "action": "create_booking | get_availability | list_services | list_staff | get_price | cancel_booking | reschedule_booking | mark_no_show | add_service | update_service | add_staff | update_schedule | block_slot | walk_in | get_insights | owner_query | general_reply | needs_info | escalate",
  "params": {},
  "reply": "natural language reply",
  "confidence": "high | medium | low"
}

Rules:
- Never invent services, staff, prices, or availability.
- The backend decides truth; you only interpret and propose actions.
- If required details are missing, use "needs_info".
- If confidence is low or the case is ambiguous, use "escalate".`;
}

function formatOwnerSummary(
  summary: Record<string, unknown> | null
): string {
  if (!summary) return '- No daily summary available';

  return Object.entries(summary)
    .slice(0, 10)
    .map(([key, value]) => `- ${key}: ${formatOwnerSummaryValue(value)}`)
    .join('\n');
}

function formatOwnerSummaryValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .slice(0, 5)
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return String(entry);
        const record = entry as Record<string, unknown>;
        return Object.entries(record)
          .slice(0, 4)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(', ');
      })
      .join(' | ');
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 8)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', ');
  }

  return String(value);
}
