/**
 * Simple retrieval stub: in-memory vector store replacement.
 * Accepts documents and performs cosine similarity over naive bag-of-words TF vectors.
 * Replace with Chroma/FAISS later. Runtime-safe (no external deps).
 */

export interface RetrievalDoc { id: string; text: string }

let docs: RetrievalDoc[] = [];

export function addDocument(id: string, text: string) {
  docs.push({ id, text });
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

export function query(text: string, limit = 3): RetrievalDoc[] {
  const qtokens = tokenize(text);
  const qvec = buildVector(qtokens);
  const scored = docs.map((d) => ({ d, score: cosine(qvec, buildVector(tokenize(d.text))) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.d);
}

export default { addDocument, query };
