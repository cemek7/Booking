/**
 * DSAR PII registry — the explicit, reviewable source of truth for which tables
 * hold an end-customer's personal data, how each links to the customer, and what
 * happens on erasure.
 *
 * IMPORTANT: `verified: false` entries have NOT been confirmed against the live
 * schema (link column and/or PII columns). Verify each against db/migrations
 * before enabling a real (non-dryRun) erasure in production. The pre-existing
 * `pii_data_registry` SQL seed (migration 027) is stale — column names there do
 * not match the current `customers` table — so do not rely on it.
 *
 * The customer anchor (`customers` row, id = customerId) is handled directly by
 * the export/erase engines and is intentionally NOT in this list.
 */

export type EraseAction = 'anonymize' | 'delete';

export type PiiLink =
  /** rows where `customer_id = <customerId>` */
  | { kind: 'customerId' }
  /** rows where any of `columns` equals the customer's phone (E.164) */
  | { kind: 'phone'; columns: string[] }
  /** rows where `reservation_id` is one of the customer's reservation ids */
  | { kind: 'reservationId' };

export interface PiiTable {
  table: string;
  link: PiiLink;
  /** Columns overwritten when anonymizing. Ignored when onErase === 'delete'. */
  piiColumns: string[];
  onErase: EraseAction;
  /** True once the link + PII columns are confirmed against the live schema. */
  verified: boolean;
}

export const CUSTOMER_PII_TABLES: PiiTable[] = [
  // Financial / booking records — KEEP the row, strip PII (tax/accounting retention).
  {
    table: 'reservations',
    link: { kind: 'customerId' },
    piiColumns: ['customer_name', 'customer_phone'],
    onErase: 'anonymize',
    verified: false,
  },
  {
    table: 'transactions',
    link: { kind: 'reservationId' },
    piiColumns: ['name'],
    onErase: 'anonymize',
    verified: false,
  },

  // Conversational / engagement data — hard delete.
  {
    table: 'messages',
    link: { kind: 'phone', columns: ['from_number', 'to_number'] },
    piiColumns: [],
    onErase: 'delete',
    verified: true,
  },
  {
    table: 'whatsapp_conversations',
    link: { kind: 'phone', columns: ['phone_number'] },
    piiColumns: [],
    onErase: 'delete',
    verified: true,
  },
  {
    table: 'escalation_queue',
    link: { kind: 'phone', columns: ['customer_phone'] },
    piiColumns: [],
    onErase: 'delete',
    verified: true,
  },
  {
    table: 'reviews',
    link: { kind: 'customerId' },
    piiColumns: [],
    onErase: 'delete',
    verified: true,
  },
  {
    table: 'customer_analytics',
    link: { kind: 'customerId' },
    piiColumns: [],
    onErase: 'delete',
    verified: true,
  },
  {
    table: 'customer_feedback',
    link: { kind: 'customerId' },
    piiColumns: [],
    onErase: 'delete',
    verified: false,
  },
  {
    table: 'leads',
    link: { kind: 'phone', columns: ['phone'] },
    piiColumns: [],
    onErase: 'delete',
    verified: true,
  },
  {
    table: 'whatsapp_media',
    link: { kind: 'phone', columns: ['customer_phone'] },
    piiColumns: [],
    onErase: 'delete',
    verified: false,
  },
];
