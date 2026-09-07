/**
 * Telegram Health Alerts
 *
 * Sends operational alerts to a configured Telegram chat.
 * Used by the health endpoint and cron workers to surface issues
 * without requiring a full monitoring stack.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN  — Bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — Chat ID (or @channelname) to send alerts to
 */

/**
 * Both senders are awaited on request paths (the inbound WhatsApp webhook
 * among them), so an unresponsive api.telegram.org would otherwise hold the
 * request open until the platform's own timeout. Matches the 15s the provider
 * adapters pass. Bounds the wait only: an abort lands in the same catch as any
 * other fetch failure, so callers still see nothing.
 */
const TELEGRAM_TIMEOUT_MS = 15_000;

async function postToTelegram(token: string, chatId: string, text: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Silently skip if not configured — alerts are optional
    return;
  }

  try {
    await postToTelegram(token, chatId, `🚨 *Booka Alert*\n\n${message}`);
  } catch (err) {
    // Never let alert failures surface to callers
    console.error('[telegramAlert] Failed to send alert:', err);
  }
}

export async function sendTelegramInfo(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  try {
    await postToTelegram(token, chatId, `ℹ️ *Booka*\n\n${message}`);
  } catch {
    // silent
  }
}
