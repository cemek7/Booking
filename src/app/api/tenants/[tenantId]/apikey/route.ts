import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateTenantAccess, auditSuperadminAction } from '@/lib/enhanced-rbac';
import crypto from 'crypto';

// POST /api/tenants/:tenantId/apikey -> { apiKey }
// Generates a new random API key and stores a hash in tenant settings (apiKeyHash + apiKeyPresent)
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  if (!tenantId) return NextResponse.json({ error: 'tenant_id_required' }, { status: 400 });

  try {
    const supabase = createServerSupabaseClient();
    
    // Authentication required for API key generation
    const auth = req.headers.get('authorization') || '';
    const token = auth.split(' ')[1] || '';
    if (!token) return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
    
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    
    const actorId = userData.user.id;
    const actorEmail = userData.user.email || null;

    // Validate tenant access - require ownership permissions for API key generation
    const validation = await validateTenantAccess(supabase, actorId, tenantId, actorEmail);
    if (!validation.hasOwnershipAccess && !validation.isSuperadmin) {
      return NextResponse.json({ error: 'Insufficient permissions for API key management' }, { status: 403 });
    }

    const { data: current } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();
      
    const settings = (current?.settings || {}) as Record<string, unknown>;
    
    // Generate secure API key
    const apiKey = crypto.randomBytes(24).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + apiKey).digest('hex');
    
    const merged = { ...settings, apiKeyHash: hash, apiKeySalt: salt, apiKeyPresent: true };

    // Audit superadmin actions
    if (validation.isSuperadmin) {
      await auditSuperadminAction(supabase, actorId, actorEmail, 'GENERATE_API_KEY', {
        tenantId
      });
    }
    
    const { error: updateErr } = await supabase
      .from('tenants')
      .update({ settings: merged })
      .eq('id', tenantId);
      
    if (updateErr) return NextResponse.json({ error: 'apikey_update_failed' }, { status: 500 });
    
    return NextResponse.json({ apiKey }); // return plaintext once; client should store securely
    
  } catch (e: any) {
    console.error('API key generation error:', e);
    return NextResponse.json({ error: 'apikey_generation_error', detail: e?.message }, { status: 500 });
  }
}
