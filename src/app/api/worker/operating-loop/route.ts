import { NextResponse } from 'next/server';
import { runOperatingDeliveryBatch } from '@/lib/operating-loop/delivery-worker';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getConversation } from '@/lib/whatsapp/v2/conversationState';
import { sendGovernedInitiated } from '@/lib/whatsapp/v2/deliverability/governedSend';
import { brandCustomerText } from '@/lib/whatsapp/v2/outboundBranding';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (
    process.env.NODE_ENV === 'production'
    && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runOperatingDeliveryBatch({
      admin: createSupabaseAdminClient(),
      getConversation,
      getProvider: getTenantWhatsAppProviderClient,
      governedSend: sendGovernedInitiated,
      brandText: brandCustomerText,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[worker/operating-loop] failed', { error: message });
    return NextResponse.json({ error: 'Operating delivery worker failed' }, { status: 500 });
  }
}
