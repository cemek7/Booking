export const DEFAULT_WHATSAPP_GRAPH_API_VERSION = 'v25.0';

export function getWhatsAppGraphApiVersion(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.WHATSAPP_API_VERSION?.trim() || DEFAULT_WHATSAPP_GRAPH_API_VERSION;
}
