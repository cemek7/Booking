import { readFileSync } from 'fs';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const png = readFileSync('/tmp/qr.png');
    return new NextResponse(png, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'QR not ready' }, { status: 404 });
  }
}
