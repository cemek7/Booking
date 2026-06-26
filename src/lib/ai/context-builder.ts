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

  const recallBlock = userRole === 'customer' && grounding.customerRecall
    ? `Returning customer context:\n${formatCustomerRecall(grounding.customerRecall)}\n`
    : '';

  const productsBlock = grounding.products.length > 0
    ? grounding.products
        .map((product) => {
          const price = typeof product.price_cents === 'number' && Number.isFinite(product.price_cents)
            ? `₦${Math.round(product.price_cents / 100).toLocaleString()}`
            : 'Price on request';
          const stock = product.track_inventory
            ? (typeof product.stock_quantity === 'number' && product.stock_quantity > 0 ? 'In stock' : 'Out of stock')
            : 'Stock status unknown';
          return `- ${product.name} [id=${product.id}]: ${price} (${stock})${product.description ? ` — ${product.description}` : ''}`;
        })
        .join('\n')
    : '- No product catalog context loaded for this request';

  const showcaseBlock = grounding.showcasePacks.length > 0
    ? grounding.showcasePacks
        .map((pack) => `- ${pack.name} [id=${pack.id}]${pack.template_kind ? ` [${pack.template_kind}]` : ''}${pack.description ? ` — ${pack.description}` : ''}`)
        .join('\n')
    : '- No showcase packs loaded for this request';

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

${recallBlock}Products / retail context:
${productsBlock}

Showcase / portfolio context:
${showcaseBlock}

${ownerBlock}Conversation state:
- Flow: ${conv.current_flow}
- Step: ${conv.flow_step}
- Booking in progress: ${JSON.stringify(conv.flow_data?.booking_in_progress ?? null)}

${retryBlock}Customer message:
"${message}"

Respond ONLY with valid JSON:
{
  "action": "create_booking | get_availability | list_services | list_staff | get_price | show_catalog | show_showcase | recommend_products | cancel_booking | reschedule_booking | mark_no_show | add_service | update_service | add_staff | update_schedule | block_slot | walk_in | get_insights | owner_query | general_reply | needs_info | escalate",
  "params": {},
  "reply": "natural language reply",
  "confidence": "high | medium | low"
}

Rules:
- Never invent services, staff, prices, or availability.
- Never invent products, stock, showcase packs, or customer history.
- The backend decides truth; you only interpret and propose actions.
- Use returning-customer recall as a soft hint only. Do not claim certainty beyond the grounded data.
- Use "show_showcase" when the customer explicitly wants a portfolio, gallery, lookbook, catalog media, or before/after examples.
- Use "show_catalog" when the customer wants a concrete list of products, prices, or stock-aware retail options.
- Use "recommend_products" when the customer wants product suggestions, add-ons, or "what should I buy/use" guidance.
- For "show_catalog" and "recommend_products", prefer product IDs from the grounded context when possible. You may also pass "product_name", "query", or "category".
- For "show_showcase", prefer a grounded showcase pack ID when possible. You may also pass "showcase_name" or "trigger_text".
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

function formatCustomerRecall(
  recall: GroundingResult['customerRecall']
): string {
  if (!recall) return '- No known recall context';

  const lines = [
    `- They have visited ${recall.visitCount} ${recall.visitCount === 1 ? 'time' : 'times'}.`,
  ];

  if (recall.lastService) {
    lines.push(`- Their last recorded service was ${recall.lastService}.`);
  }
  if (recall.usualStaff) {
    lines.push(`- They often book with ${recall.usualStaff}.`);
  }
  if (recall.lastVisitAt) {
    lines.push(`- Their last visit was ${humanizeSince(recall.lastVisitAt)}.`);
  }
  if (recall.rebookingDue) {
    lines.push('- They may be due for a rebook based on their last service interval.');
  }

  lines.push('- Greet them warmly, you may suggest their usual, but confirm what they actually want before assuming details.');

  return lines.join('\n');
}

function humanizeSince(isoTimestamp: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return isoTimestamp;

  const diffMs = Math.max(0, Date.now() - parsed);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return 'today';
  if (diffDays === 1) return 'about 1 day ago';
  if (diffDays < 7) return `about ${diffDays} days ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `about ${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `about ${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;

  const diffYears = Math.floor(diffDays / 365);
  return `about ${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`;
}
