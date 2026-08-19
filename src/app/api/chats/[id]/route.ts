export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  CHAT_SUPPORT_STATUSES,
  getChatSupportState,
  mergeChatSupportState,
  type ChatMetadata,
} from '@/lib/chats/operations';

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }),
  z.object({ action: z.literal('assign'), assigneeUserId: z.string().uuid() }),
  z.object({ action: z.literal('unassign') }),
  z.object({ action: z.literal('status'), status: z.enum(CHAT_SUPPORT_STATUSES) }),
]);

type ChatRow = {
  id: string;
  tenant_id: string;
  metadata: ChatMetadata;
};

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const userId = ctx.user?.id;
    if (!tenantId || !userId) {
      throw ApiErrorFactory.forbidden('Authenticated tenant membership is required');
    }

    const id = ctx.params?.id;
    if (!id) {
      throw ApiErrorFactory.validationError({ id: 'Chat ID required' });
    }

    const body = await ctx.request.json();
    const parsed = ActionSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const admin = createSupabaseAdminClient();
    const { data: chat, error: chatError } = await admin
      .from('chats')
      .select('id,tenant_id,metadata')
      .eq('id', id)
      .maybeSingle();

    if (chatError) {
      throw ApiErrorFactory.internalServerError(new Error(`Failed to load chat: ${chatError.message}`));
    }

    if (!chat || (chat as ChatRow).tenant_id !== tenantId) {
      throw ApiErrorFactory.notFound('Chat');
    }

    let metadata = (chat as ChatRow).metadata ?? null;

    if (parsed.data.action === 'claim' || parsed.data.action === 'assign') {
      const assigneeUserId =
        parsed.data.action === 'assign' ? parsed.data.assigneeUserId : userId;
      const { data: membership, error: membershipError } = await admin
        .from('tenant_users')
        .select('name,email')
        .eq('tenant_id', tenantId)
        .eq('user_id', assigneeUserId)
        .maybeSingle();

      if (membershipError) {
        throw ApiErrorFactory.internalServerError(
          new Error(`Failed to resolve tenant membership: ${membershipError.message}`)
        );
      }
      if (!membership) {
        throw ApiErrorFactory.notFound('Tenant team member');
      }

      metadata = mergeChatSupportState(metadata, {
        assigneeUserId,
        assigneeLabel:
          membership.name || membership.email || 'Assigned agent',
      });
    } else if (parsed.data.action === 'unassign') {
      metadata = mergeChatSupportState(metadata, {
        assigneeUserId: null,
        assigneeLabel: null,
      });
    } else {
      metadata = mergeChatSupportState(metadata, {
        status: parsed.data.status,
      });
    }

    const { error: updateError } = await admin
      .from('chats')
      .update({ metadata })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (updateError) {
      throw ApiErrorFactory.internalServerError(new Error(`Failed to update chat: ${updateError.message}`));
    }

    return {
      chat: {
        id,
        ...getChatSupportState(metadata),
      },
    };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
