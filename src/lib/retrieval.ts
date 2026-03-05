/**
 * Retrieval module: per-tenant in-memory TF-IDF vector store.
 * Documents are loaded from the `tenant_knowledge_articles` table and cached
 * per-tenant. Replace with Chroma/FAISS for production-scale deployments.
 * Runtime-safe (no external deps).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RetrievalDoc { id: string; text: string; category?: string }

/** Per-tenant document stores */
const tenantDocs = new Map<string, RetrievalDoc[]>();
/** Shared global store (legacy — kept for backward-compat) */
let docs: RetrievalDoc[] = [];

export function addDocument(id: string, text: string) {
  docs.push({ id, text });
}

/**
 * Load knowledge articles from the DB for a tenant and cache them so
 * subsequent `queryTenant` calls are fast (no extra DB round-trips).
 */
export async function loadTenantDocuments(
  tenantId: string,
  supabase: SupabaseClient
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('tenant_knowledge_articles')
      .select('id, title, content, category')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (error) {
      console.warn('[retrieval] Failed to load tenant knowledge articles:', error.message);
      return;
    }

    const articles: RetrievalDoc[] = (data ?? []).map((row: { id: string; title: string; content: string; category: string }) => ({
      id: row.id,
      // Concatenate title + content so both are searchable
      text: `${row.title}: ${row.content}`,
      category: row.category,
    }));

    tenantDocs.set(tenantId, articles);
  } catch (err) {
    console.warn('[retrieval] Unexpected error loading documents:', err);
  }
}

/**
 * Query per-tenant knowledge base. Falls back to the global store if the
 * tenant has no loaded documents.
 */
export function queryTenant(tenantId: string, text: string, limit = 3): RetrievalDoc[] {
  const store = tenantDocs.get(tenantId) ?? docs;
  return _query(store, text, limit);
}

function tokenize(t: string) {
  return t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function buildVector(tokens: string[]) {
  const vec: Record<string, number> = {};
  for (const tk of tokens) vec[tk] = (vec[tk] || 0) + 1;
  return vec;
}

function cosine(a: Record<string, number>, b: Record<string, number>) {
  let dot = 0; let asq = 0; let bsq = 0;
  for (const k of Object.keys(a)) { asq += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
  for (const k of Object.keys(b)) { bsq += b[k] * b[k]; }
  const denom = Math.sqrt(asq) * Math.sqrt(bsq);
  return denom === 0 ? 0 : dot / denom;
}

function _query(store: RetrievalDoc[], text: string, limit: number): RetrievalDoc[] {
  const qtokens = tokenize(text);
  const qvec = buildVector(qtokens);
  const scored = store.map((d) => ({ d, score: cosine(qvec, buildVector(tokenize(d.text))) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.d);
}

export function query(text: string, limit = 3): RetrievalDoc[] {
  return _query(docs, text, limit);
}

export default { addDocument, query, queryTenant, loadTenantDocuments };
