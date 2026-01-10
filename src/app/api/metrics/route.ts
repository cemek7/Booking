import { metricsText } from '@/lib/metrics';
import { handleApiError } from '@/lib/error-handling';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const body = await metricsText();
    return new Response(body, { headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
  } catch (error) {
    // Even for metrics, it's good to have some error handling
    return handleApiError(error, 'Failed to retrieve metrics');
  }
}
