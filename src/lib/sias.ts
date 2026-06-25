export type SIASVertical = 'beauty' | 'hospitality' | 'medicine';

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
    name: 'Core',
    price: '₦15k/mo',
    description: 'Booking core, reminders, and tenant workspace.',
    included: ['Booking intake', 'WhatsApp confirmations', 'Basic analytics'],
  },
  {
    id: 'front-desk',
    name: 'AI Front Desk',
    price: '₦45k/mo',
    description: 'Managed conversational front desk with automated follow-up.',
    included: ['Always-on WhatsApp assistant', 'Reminder automation', 'Escalation queue'],
  },
  {
    id: 'growth-ops',
    name: 'Growth Ops',
    price: '₦85k/mo',
    description: 'Campaigns, reactivation, revenue recovery, and richer analytics.',
    included: ['Reactivation engine', 'Outcome attribution', 'Campaign retries'],
  },
  {
    id: 'managed-ops',
    name: 'Managed Operations',
    price: '₦250k+',
    description: 'Human + AI hybrid operations layer with ongoing service support.',
    included: ['Human escalation', 'Managed onboarding', 'Operational memory'],
  },
] as const;

export function getVerticalPackage(vertical: string | undefined | null) {
  return SIAS_VERTICAL_PACKAGES.find((pkg) => pkg.id === vertical) ?? SIAS_VERTICAL_PACKAGES[0];
}
