import { NextRequest, NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/shopify';

export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get('shop');

  if (!shop) {
    return NextResponse.json({ error: 'Missing shop parameter' }, { status: 400 });
  }

  // Validate shop domain format
  if (!shop.endsWith('.myshopify.com')) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
  }

  const authUrl = buildAuthUrl(shop);
  return NextResponse.redirect(authUrl);
}
