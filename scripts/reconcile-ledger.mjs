// Ledger reconciliation script - generates financial reconciliation reports
// Usage (PowerShell): 
// $env:SUPABASE_URL="https://your.project"; $env:SUPABASE_SERVICE_ROLE_KEY="key"; node scripts/reconcile-ledger.mjs [tenant-id] [date]
import { createServerSupabaseClient } from '../src/lib/supabaseClient';
import { existsSync } from 'fs';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';

// Load env from .env.local if present, else .env
const envLocal = join(process.cwd(), '.env.local');
if (existsSync(envLocal)) dotenvConfig({ path: envLocal });
else dotenvConfig();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createServerSupabaseClient();

async function generateReconciliationReport(tenantId, date) {
  const targetDate = date || new Date().toISOString().split('T')[0];
  console.log(`\n=== Ledger Reconciliation Report ===`);
  console.log(`Date: ${targetDate}`);
  console.log(`Tenant: ${tenantId || 'ALL'}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('=' .repeat(45));

  // Build query filters
  let transactionsQuery = supabase
    .from('transactions')
    .select(`
      id, 
      tenant_id, 
      amount, 
      currency, 
      type, 
      status,
      reconciliation_status,
      provider_reference,
      created_at,
      reconciled_at
    `)
    .gte('created_at', `${targetDate}T00:00:00.000Z`)
    .lt('created_at', `${targetDate}T23:59:59.999Z`);

  if (tenantId) {
    transactionsQuery = transactionsQuery.eq('tenant_id', tenantId);
  }

  const { data: transactions, error: txnError } = await transactionsQuery.order('created_at');

  if (txnError) {
    console.error('Error fetching transactions:', txnError);
    process.exit(1);
  }

  // Build ledger query
  let ledgerQuery = supabase
    .from('ledger_entries')
    .select(`
      id,
      tenant_id,
      transaction_id,
      entry_type,
      amount,
      currency,
      description,
      posted_at
    `)
    .gte('posted_at', `${targetDate}T00:00:00.000Z`)
    .lt('posted_at', `${targetDate}T23:59:59.999Z`);

  if (tenantId) {
    ledgerQuery = ledgerQuery.eq('tenant_id', tenantId);
  }

  const { data: ledgerEntries, error: ledgerError } = await ledgerQuery.order('posted_at');

  if (ledgerError) {
    console.error('Error fetching ledger entries:', ledgerError);
    process.exit(1);
  }

  // Summary calculations
  const totalTransactions = transactions?.length || 0;
  const totalLedgerEntries = ledgerEntries?.length || 0;
  
  const transactionsSummary = (transactions || []).reduce((acc, txn) => {
    acc.totalAmount += Number(txn.amount) || 0;
    acc.byStatus[txn.status] = (acc.byStatus[txn.status] || 0) + 1;
    acc.byType[txn.type] = (acc.byType[txn.type] || 0) + 1;
    acc.byReconciliation[txn.reconciliation_status] = (acc.byReconciliation[txn.reconciliation_status] || 0) + 1;
    return acc;
  }, { totalAmount: 0, byStatus: {}, byType: {}, byReconciliation: {} });

  const ledgerSummary = (ledgerEntries || []).reduce((acc, entry) => {
    acc.totalAmount += Number(entry.amount) || 0;
    acc.byType[entry.entry_type] = (acc.byType[entry.entry_type] || 0) + 1;
    return acc;
  }, { totalAmount: 0, byType: {} });

  // Print summary
  console.log(`\nTransactions Summary:`);
  console.log(`  Total Count: ${totalTransactions}`);
  console.log(`  Total Amount: ${transactionsSummary.totalAmount.toFixed(2)}`);
  console.log(`  By Status: ${JSON.stringify(transactionsSummary.byStatus, null, 2)}`);
  console.log(`  By Type: ${JSON.stringify(transactionsSummary.byType, null, 2)}`);
  console.log(`  By Reconciliation: ${JSON.stringify(transactionsSummary.byReconciliation, null, 2)}`);

  console.log(`\nLedger Entries Summary:`);
  console.log(`  Total Count: ${totalLedgerEntries}`);
  console.log(`  Total Amount: ${ledgerSummary.totalAmount.toFixed(2)}`);
  console.log(`  By Type: ${JSON.stringify(ledgerSummary.byType, null, 2)}`);

  // Identify discrepancies
  console.log(`\nDiscrepancies:`);
  const unreconciled = transactions?.filter(t => t.reconciliation_status !== 'matched') || [];
  if (unreconciled.length > 0) {
    console.log(`  Unreconciled Transactions: ${unreconciled.length}`);
    unreconciled.forEach(txn => {
      console.log(`    - ${txn.id}: ${txn.status} | ${txn.reconciliation_status} | ${txn.amount} ${txn.currency}`);
    });
  } else {
    console.log(`  ✓ All transactions reconciled`);
  }

  // Orphaned ledger entries (no matching transaction)
  const transactionIds = new Set(transactions?.map(t => t.id) || []);
  const orphanedEntries = ledgerEntries?.filter(e => e.transaction_id && !transactionIds.has(e.transaction_id)) || [];
  
  if (orphanedEntries.length > 0) {
    console.log(`  Orphaned Ledger Entries: ${orphanedEntries.length}`);
    orphanedEntries.forEach(entry => {
      console.log(`    - ${entry.id}: ${entry.entry_type} | ${entry.amount} ${entry.currency} | Missing txn: ${entry.transaction_id}`);
    });
  }

  // Balance check
  const netTransactionAmount = transactionsSummary.totalAmount;
  const netLedgerAmount = ledgerSummary.totalAmount;
  const balanceDiff = Math.abs(netTransactionAmount - netLedgerAmount);
  
  console.log(`\nBalance Check:`);
  console.log(`  Net Transaction Amount: ${netTransactionAmount.toFixed(2)}`);
  console.log(`  Net Ledger Amount: ${netLedgerAmount.toFixed(2)}`);
  console.log(`  Difference: ${balanceDiff.toFixed(2)}`);
  
  if (balanceDiff < 0.01) {
    console.log(`  ✓ Balances match`);
  } else {
    console.log(`  ⚠ Balance discrepancy detected`);
  }

  console.log(`\n=== End Report ===\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const tenantId = args[0]; // Optional: specific tenant ID
  const date = args[1]; // Optional: specific date (YYYY-MM-DD)

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node reconcile-ledger.mjs [tenant-id] [date]');
    console.log('  tenant-id: UUID of specific tenant (optional)');
    console.log('  date: Date in YYYY-MM-DD format (default: today)');
    process.exit(0);
  }

  await generateReconciliationReport(tenantId, date);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});