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

export async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Silently skip if not configured — alerts are optional
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🚨 *Booka Alert*\n\n${message}`,
        parse_mode: 'Markdown',
      }),
    });
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
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `ℹ️ *Booka*\n\n${message}`,
        parse_mode: 'Markdown',
      }),
    });
  } catch {
    // silent
  }
}
