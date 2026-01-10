import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/supabaseClient';
import { getSession } from '../../../../../lib/auth/session';
import { validateTenantAccess } from '../../../../../lib/enhanced-rbac';
import { z } from 'zod';
import { handleApiError } from '../../../../../lib/error-handling';
import { UserRole } from '../../../../../../types';
import { chatMessagesSent, observeRequest } from '../../../../../lib/metrics';
import { trace } from '@opentelemetry/api';

interface RouteParams {
  params: { id: string };
}

const PostMessageBodySchema = z.object({
  text: z.string().trim().min(1, 'Message text cannot be empty'),
});

/**
 * POST /api/chats/{id}/messages
 * Sends a new message in a chat.
 * Requires 'staff' or higher role.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const tracer = trace.getTracer('boka-api');
  const span = tracer.startSpan('chat.message.send');
  const startTime = process.hrtime.bigint();

  try {
    const chatId = params.id;
    if (!chatId) {
      return NextResponse.json({ error: 'Chat ID is required' }, { status: 400 });
    }
    span.setAttribute('chat.id', chatId);

    const { session, tenantId: userTenantId } = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const bodyValidation = PostMessageBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      return NextResponse.json({ error: 'Invalid request body', details: bodyValidation.error.issues }, { status: 400 });
    }
    const { text } = bodyValidation.data;

    const supabase = createServerSupabaseClient();
    
    // 1. Fetch the chat to verify it exists and get its tenant_id
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, tenant_id, customer_phone')
      .eq('id', chatId)
      .single();

    if (chatError || !chat) {
      span.setAttribute('chat.found', false);
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    span.setAttribute('tenant.id', chat.tenant_id);

    // 2. Authorize the user against the chat's tenant
    await validateTenantAccess(session.user.id, chat.tenant_id, [UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]);
    span.setAttribute('auth.authorized', true);

    // 3. Insert the outbound message
    const { data: newMessage, error: insertError } = await supabase
      .from('messages')
      .insert({
        chat_id: chatId,
        tenant_id: chat.tenant_id,
        user_id: session.user.id,
        content: text,
        direction: 'outbound',
        to_number: chat.customer_phone,
      })
      .select('id, created_at')
      .single();

    if (insertError) {
      span.recordException(insertError);
      throw insertError;
    }
    
    try { chatMessagesSent.inc({ tenant: chat.tenant_id }); } catch {}
    span.addEvent('Message inserted into DB');

    // 4. Fire-and-forget handoff to external messaging provider (e.g., Evolution API)
    // This part remains async and does not block the response
    (async () => {
        try {
            const { data: tenant } = await supabase
              .from('tenants')
              .select('whatsapp_api_provider, waba_api_key, whatsapp_number_id, whatsapp_number')
              .eq('id', chat.tenant_id)
              .single();
            
            const baseUrl = process.env.EVOLUTION_BASE_URL || 'https://api.evolution-api.com';
            const apiKey = tenant?.waba_api_key || process.env.EVOLUTION_API_KEY;
            const instance = tenant?.whatsapp_number_id;
            const number = chat?.customer_phone;

            if (apiKey && instance && number) {
                await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
                    body: JSON.stringify({ number, textMessage: { text } }),
                });
                span.addEvent('Handoff to Evolution API successful');
            } else {
                span.addEvent('Handoff to Evolution API skipped: missing config');
            }
        } catch (e) {
            span.recordException(e as Error);
            console.error('Evolution API handoff failed:', e);
        }
    })();

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    observeRequest('/api/chats/[id]/messages', 'POST', 200, duration);
    span.setAttribute('duration.seconds', duration);

    return NextResponse.json({ ok: true, id: newMessage.id, createdAt: newMessage.created_at }, { status: 201 });

  } catch (error) {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    observeRequest('/api/chats/[id]/messages', 'POST', 500, duration);
    return handleApiError(error, 'Failed to send message');
  } finally {
    span.end();
  }
}
