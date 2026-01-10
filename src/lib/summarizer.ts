/**
 * Small synchronous summarizer used as a cheap fallback when chat history is long.
 * For now it returns a naive condensed summary (join/truncate). A more advanced
 * summarization using LLMs can be added as an async worker job later.
 */

export function summarizeMessages(messages: Array<{ content?: string | null }>, maxLen = 500) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  // join last N messages into a single text and truncate
  const joined = messages.map((m) => (m.content || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
  if (joined.length <= maxLen) return joined;
  // basic smart-truncate: keep last part (most recent) and prefix with summary marker
  return joined.slice(Math.max(0, joined.length - maxLen));
}

const summarizer = { summarizeMessages };
export default summarizer;
