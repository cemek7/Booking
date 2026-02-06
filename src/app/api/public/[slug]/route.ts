/**
 * Public Booking Routes - No Authentication Required
 */

import { NextRequest, NextResponse } from 'next/server';
import publicBookingService from '@/lib/publicBookingService';

/**
 * GET /api/public/[slug]
 * Get public tenant info (header, logo, description)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;

    if (!slug) {
      return NextResponse.json({ error: 'Slug required' }, { status: 400 });
    }

    const tenantInfo = await publicBookingService.getTenantPublicInfo(slug);
    return NextResponse.json(tenantInfo);
  } catch (error) {
    console.error('Error fetching tenant info:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tenant' },
      { status: 404 }
    );
  }
}
