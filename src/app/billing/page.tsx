export default function BillingPlaceholder() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Billing (Coming Soon)</h1>
      <p className="text-sm text-gray-600 max-w-prose">
        This page will surface invoice history, subscription status, deposit conversion metrics, and payment method management.
        Implementation is deferred until booking & payments endpoints are finalized. Target: after composer & side panel integration.
      </p>
      <ul className="list-disc pl-5 text-sm text-gray-500">
        <li>Invoices list (date, amount, status)</li>
        <li>Current plan & usage</li>
        <li>Deposit summary (pending vs captured)</li>
        <li>Upgrade / payment method management</li>
        <li>Upcoming: failed payment alerts & retry actions</li>
      </ul>
      <div className="text-xs text-gray-400">Stub created {new Date().toISOString()}</div>
    </div>
  );
}