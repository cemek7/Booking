import { NextResponse } from "next/server";
import { createHttpHandler } from "@/lib/error-handling/route-handler";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildAuthorizeUrl,
  isGhlIntegrationEnabled,
} from "@/lib/integrations/ghl/config";
import { issueState } from "@/lib/integrations/ghl/oauthState";

/**
 * POST /api/integrations/ghl/start
 *
 * Mints a single-use state and returns the HighLevel authorize URL. Restricted
 * to superadmins: this is a private sandbox integration, not something a tenant
 * self-serves. The URL carries client_id, which is public, and never the secret.
 */

export const dynamic = "force-dynamic";

export const POST = createHttpHandler(
  async (ctx) => {
    if (!isGhlIntegrationEnabled()) {
      return NextResponse.json({ error: "not_enabled" }, { status: 404 });
    }

    const admin = getSupabaseAdmin();
    const state = await issueState(admin, {
      tenantId: ctx.user?.tenantId ?? null,
      createdBy: ctx.user?.id ?? null,
    });

    return { authorizeUrl: buildAuthorizeUrl(state) };
  },
  "POST",
  { auth: true, roles: ["superadmin"], requireTenantMembership: false },
);
