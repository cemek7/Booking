// @ts-nocheck
import { defaultLogger } from '@/lib/logger';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

class HttpInstrumentation {
  constructor(_options: { ignoreIncomingRequestHook?: (req: { url?: string }) => boolean }) {}
}

if (process.env.NODE_ENV !== 'production') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
}

let sdk: NodeSDK | undefined;

export function initTelemetry() {
  // Skip telemetry in development/non-production environments for now
  // The @opentelemetry/resources module has compatibility issues with Turbopack
  if (process.env.NODE_ENV !== 'production') {
    defaultLogger.info('ℹ️ Telemetry disabled in development');
    return undefined;
  }

  if (sdk) return sdk;
  try {
    const traceExporter = new OTLPTraceExporter({});
    const resource = resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: 'boka',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'booking-platform',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '0.0.0'
    });
    sdk = new NodeSDK({
      resource,
      traceExporter,
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req) => req.url === '/api/metrics'
        })
      ]
    });
    sdk.start();
  } catch (e) {
    defaultLogger.error('Telemetry init failed', e);
  }
  return sdk;
}

export async function shutdownTelemetry() {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (e) {
    defaultLogger.error('Telemetry shutdown error', e);
  }
}

initTelemetry();

// Next.js instrumentation hook — called once per server process startup
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { observability } = await import('@/lib/observability/node-observability');
    await observability.initialize({
      serviceName: 'boka-api',
      serviceVersion: process.env.APP_VERSION ?? '1.0.0',
      environment: process.env.NODE_ENV ?? 'development',
    });

    // Validate that at least one payment provider is configured
    const hasStripe = !!process.env.STRIPE_SECRET_KEY;
    const hasPaystack = !!process.env.PAYSTACK_SECRET_KEY;
    if (!hasStripe && !hasPaystack) {
      defaultLogger.warn(
        'No payment provider configured: STRIPE_SECRET_KEY and PAYSTACK_SECRET_KEY are both unset. ' +
        'Payment routes will fail at runtime. Set at least one before going live.'
      );
    }

    const disableLegacyWhatsAppProcessor =
      process.env.WHATSAPP_V2_DISABLE_LEGACY_PROCESSOR === 'true';

    if (process.env.NODE_ENV !== 'test' && !disableLegacyWhatsAppProcessor) {
      const { startWhatsAppProcessor } = await import('@/lib/whatsapp/messageProcessor');
      await startWhatsAppProcessor();
    }
  }
}
