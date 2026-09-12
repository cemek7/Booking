import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  clientIpFrom,
  hashIp,
  submitInquiry,
} from "@/lib/inquiries/platformInquiries";

/**
 * POST /api/contact — the Techclave contact form.
 *
 * Deliberately public and unauthenticated: it is how someone who has never used
 * Booka reaches us. It writes with the service-role client because
 * platform_inquiries has RLS enabled and no policies, so the public can submit
 * without ever being able to read anyone else's inquiry back.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Please check the form." },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const result = await submitInquiry(admin, body, {
    ipHash: hashIp(clientIpFrom(request.headers)),
    userAgent: request.headers.get("user-agent"),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, fields: result.fields },
      { status: result.status },
    );
  }

  // The id is not returned: it is of no use to the submitter and an inquiry
  // identifier is not something to hand out.
  return NextResponse.json({ ok: true }, { status: 201 });
}
