import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

if (process.env.NODE_ENV !== 'production') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
}

let sdk: NodeSDK | undefined;

export function initTelemetry() {
  // Skip telemetry in development/non-production environments for now
  // The @opentelemetry/resources module has compatibility issues with Turbopack
  if (process.env.NODE_ENV !== 'production') {
    console.log('ℹ️ Telemetry disabled in development');
    return undefined;
  }

  if (sdk) return sdk;
  try {
    const traceExporter = new OTLPTraceExporter({});
    const resource = new Resource({
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
    console.error('Telemetry init failed', e);
  }
  return sdk;
}

export async function shutdownTelemetry() {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (e) {
    console.error('Telemetry shutdown error', e);
  }
}

initTelemetry();
