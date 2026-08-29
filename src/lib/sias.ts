export type SIASVertical = 'beauty' | 'hospitality' | 'medicine' | 'retail' | 'home_services' | 'professional' | 'general';

export const BOOKA_POSITIONING = {
  category: 'AI Revenue Front Desk',
  headline: 'Turn your WhatsApp and Instagram enquiries into booked and paying customers.',
  campaignLine: 'Turn conversations into customers.',
} as const;

export type SIASOutcomeSignal = {
  id: string;
  label: string;
  description: string;
  benchmark: string;
};

export type SIASVerticalPackage = {
  id: SIASVertical;
  name: string;
  subtitle: string;
  positioning: string;
  managedPromise: string;
  outcomes: string[];
  defaultFlows: string[];
  metrics: SIASOutcomeSignal[];
  templates: string[];
  escalationRules: string[];
  memorySignals: string[];
  billingModel: string;
  starterPlan: {
    label: string;
    price: string;
    description: string;
  };
};

export const SIAS_VERTICAL_PACKAGES: SIASVerticalPackage[] = [
  {
    id: 'beauty',
    name: 'Beauty Front Desk',
    subtitle: 'Salons, spas, medspas, and studios',
    positioning: 'AI operations assistant for service businesses that run on WhatsApp and repeat bookings.',
    managedPromise: 'We answer, book, remind, recover, and re-engage customers with minimal staff overhead.',
    outcomes: [
      'Reduce no-shows',
      'Increase repeat bookings',
      'Recover missed revenue',
      'Keep the diary full',
    ],
    defaultFlows: [
      'booking intake',
      'deposit collection',
      '24h reminder',
      'no-show recovery',
      'review request',
    ],
    metrics: [
      { id: 'no_show_rate', label: 'No-show rate', description: 'Before vs after Booka', benchmark: '< 15%' },
      { id: 'repeat_rate', label: 'Repeat booking rate', description: 'Customers returning within 30/60/90 days', benchmark: '+20%' },
      { id: 'reactivation', label: 'Reactivation lift', description: 'Dormant customers rebooked automatically', benchmark: '+10%' },
    ],
    templates: [
      'booking confirmation',
      'deposit follow-up',
      'reschedule nudge',
      'review request',
    ],
    escalationRules: [
      'Angry customer',
      'Refund request',
      'Double booking conflict',
      'Custom discount approval',
    ],
    memorySignals: [
      'Preferred stylist',
      'Favorite service',
      'Price sensitivity',
      'No-show history',
    ],
    billingModel: 'Subscription + usage + managed ops add-on',
    starterPlan: {
      label: 'AI Front Desk',
      price: '₦45k/mo',
      description: 'Always-on booking, reminders, and escalation handling.',
    },
  },
  {
    id: 'hospitality',
    name: 'Guest Ops Desk',
    subtitle: 'Boutique hotels, restaurants, lounges, and venues',
    positioning: 'Conversational reservations and customer operations for hospitality teams that need fewer missed reservations.',
    managedPromise: 'We handle bookings, pre-arrival nudges, deposits, upsells, and guest recovery flows.',
    outcomes: [
      'Fill weak slots',
      'Increase reservation conversion',
      'Capture more deposits',
      'Recover lost guests',
    ],
    defaultFlows: [
      'reservation intake',
      'deposit request',
      'pre-arrival reminder',
      'walk-in recovery',
      'guest feedback',
    ],
    metrics: [
      { id: 'reservation_conversion', label: 'Reservation conversion', description: 'Inquiry to reservation conversion', benchmark: '+15%' },
      { id: 'deposit_capture', label: 'Deposit capture', description: 'Reservations protected with deposits', benchmark: '>= 20%' },
      { id: 'revenue_lift', label: 'Upsell lift', description: 'Add-on and premium slot revenue', benchmark: '+8%' },
    ],
    templates: [
      'table reservation',
      'pre-arrival check-in',
      'birthday upsell',
      'review request',
    ],
    escalationRules: [
      'VIP guest request',
      'Last-minute cancellation',
      'Table conflict',
      'Special accommodation request',
    ],
    memorySignals: [
      'Favourite table',
      'Dietary preference',
      'Typical visit time',
      'Group size pattern',
    ],
    billingModel: 'Platform fee + reservation volume + managed service tier',
    starterPlan: {
      label: 'Managed Reservations',
      price: '₦85k/mo',
      description: 'Front-desk automation plus guest recovery and deposit collection.',
    },
  },
  {
    id: 'medicine',
    name: 'Patient Ops Layer',
    subtitle: 'Clinics, labs, diagnostics, and specialist practices',
    positioning: 'Appointment handling, reminders, and patient follow-up with safe escalation for sensitive cases.',
    managedPromise: 'We streamline scheduling, follow-up, reminders, and patient recall without adding admin burden.',
    outcomes: [
      'Reduce missed appointments',
      'Improve follow-up rates',
      'Increase recall adherence',
      'Tighten patient communication',
    ],
    defaultFlows: [
      'appointment scheduling',
      'results follow-up',
      'recall message',
      'non-sensitive intake',
      'human escalation',
    ],
    metrics: [
      { id: 'missed_appointments', label: 'Missed appointments', description: 'Attendance before vs after automation', benchmark: '< 10%' },
      { id: 'follow_up_rate', label: 'Follow-up rate', description: 'Patients responding to recalls', benchmark: '+25%' },
      { id: 'response_time', label: 'Response time', description: 'Time to first response on WhatsApp', benchmark: '< 2 min' },
    ],
    templates: [
      'appointment reminder',
      'results ready',
      'follow-up recall',
      'escalation handoff',
    ],
    escalationRules: [
      'Medical-sensitive question',
      'Urgent symptom mention',
      'Refund or billing dispute',
      'Escalate to staff only',
    ],
    memorySignals: [
      'Preferred communication channel',
      'Appointment cadence',
      'Follow-up history',
      'Recall compliance',
    ],
    billingModel: 'Subscription + secure workflows + managed ops',
    starterPlan: {
      label: 'Patient Operations',
      price: 'Custom',
      description: 'Conscious communication, scheduling, and follow-up with escalation controls.',
    },
  },
  ...([
    ['retail', 'Commerce Desk', 'Retailers, shops, and product-led brands', 'AI sales and customer operations for businesses that turn messages into product orders.', 'We answer product questions, guide purchases, recover carts, and keep customers returning.', ['Increase order conversion', 'Recover abandoned baskets', 'Improve repeat purchases', 'Keep stock conversations accurate'], ['product discovery', 'order intake', 'cart recovery', 'delivery follow-up', 'review request']],
    ['home_services', 'Local Service Desk', 'Home, repair, automotive, and field-service teams', 'AI intake and dispatch support for local businesses that quote, schedule, and deliver work.', 'We qualify requests, capture job details, arrange visits, and follow up on quotes.', ['Respond faster', 'Convert more quotes', 'Fill field capacity', 'Reduce missed follow-up'], ['quote intake', 'service-area check', 'visit scheduling', 'quote follow-up', 'review request']],
    ['professional', 'Client Intake Desk', 'Consultants, agencies, legal, and professional services', 'A conversational front desk for businesses that need to qualify enquiries before a consultation or proposal.', 'We gather context, route qualified leads, schedule consultations, and protect follow-up.', ['Qualify leads earlier', 'Increase consultation conversion', 'Shorten response time', 'Protect pipeline follow-up'], ['consultation intake', 'lead qualification', 'consultation scheduling', 'proposal follow-up', 'review request']],
    ['general', 'Business Front Desk', 'Growing businesses with bookings, sales, or enquiries', 'One conversational front desk for customer questions, sales, bookings, and follow-up.', 'We help customers find the next best action, then keep the conversation moving.', ['Respond faster', 'Capture demand', 'Improve conversion', 'Retain customer context'], ['customer intake', 'booking or order routing', 'follow-up', 'review request']],
  ] as const).map(([id, name, subtitle, positioning, managedPromise, outcomes, defaultFlows]) => ({
    id: id as SIASVertical,
    name,
    subtitle,
    positioning,
    managedPromise,
    outcomes: [...outcomes],
    defaultFlows: [...defaultFlows],
    metrics: [{ id: 'conversion', label: 'Conversion', description: 'Qualified conversations that become customer outcomes', benchmark: '+10%' }],
    templates: ['customer follow-up', 'conversion nudge', 'review request'],
    escalationRules: ['Customer complaint', 'Refund request', 'Manual approval required'],
    memorySignals: ['Customer intent', 'Past conversations', 'Preferred channel'],
    billingModel: 'Subscription + usage + managed operations add-on',
    starterPlan: { label: 'AI Front Desk', price: '₦45k/mo', description: 'Customer conversations, conversion, and follow-up.' },
  })),
];

export const SIAS_POSITIONING = [
  'Automated front desk',
  'Managed customer operations',
  'Revenue recovery engine',
  'Conversational operating system',
];

export const SIAS_OUTCOME_ATRIBUTION = [
  {
    id: 'no_show_reduction',
    label: 'No-show reduction',
    description: 'Track how reminders and deposits lower missed appointments.',
  },
  {
    id: 'revenue_recovery',
    label: 'Revenue recovery',
    description: 'Measure deposits, recovered bookings, and reactivation campaigns.',
  },
  {
    id: 'repeat_booking_lift',
    label: 'Repeat booking lift',
    description: 'Track return visits by segment and channel.',
  },
  {
    id: 'reactivation_lift',
    label: 'Reactivation lift',
    description: 'Measure dormant customer re-engagement.',
  },
];

export const SIAS_ESCALATION_TYPES = [
  'angry_customer',
  'refund_request',
  'double_booking',
  'medical_sensitive',
  'vip_exception',
  'manual_discount',
] as const;

export const SIAS_CAMPAIGN_ACTIONS = [
  'send_reminder',
  'send_reactivation',
  'request_review',
  'offer_upsell',
  'escalate_to_human',
  'tag_customer_memory',
] as const;

export const SIAS_BILLING_PLANS = [
  {
    id: 'core',
    name: 'Booka Core',
    price: '₦15k/mo',
    description: 'Booking core, reminders, and tenant workspace.',
    included: ['Booking intake', 'WhatsApp confirmations', 'Basic analytics'],
    usagePolicy: 'Includes a limited automation allowance with usage alerts before any overage.',
  },
  {
    id: 'front-desk',
    name: 'Booka Revenue Front Desk',
    price: '₦45k/mo',
    description: 'Managed conversational front desk with automated follow-up.',
    included: ['Always-on WhatsApp assistant', 'Reminder automation', 'Escalation queue'],
    usagePolicy: 'Includes standard AI and messaging usage with transparent, opt-in overages.',
  },
  {
    id: 'growth-ops',
    name: 'Booka Growth',
    price: '₦85k/mo',
    description: 'Campaigns, reactivation, revenue recovery, and richer analytics.',
    included: ['Reactivation engine', 'Outcome attribution', 'Campaign retries'],
    usagePolicy: 'Includes higher AI, follow-up, and campaign usage with approval for large sends.',
  },
  {
    id: 'managed-ops',
    name: 'Managed Revenue Operations',
    price: '₦250k+',
    description: 'Human + AI hybrid operations layer with ongoing service support.',
    included: ['Human escalation', 'Managed onboarding', 'Operational memory'],
    usagePolicy: 'Custom usage, service levels, and campaign controls are agreed before launch.',
  },
] as const;

export function getVerticalPackage(vertical: string | undefined | null) {
  return SIAS_VERTICAL_PACKAGES.find((pkg) => pkg.id === vertical) ?? SIAS_VERTICAL_PACKAGES.find((pkg) => pkg.id === 'general')!;
}
