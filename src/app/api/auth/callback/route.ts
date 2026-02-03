import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, fetchShopTimezone } from '@/lib/shopify';
import { prisma } from '@/lib/prisma';
import { setShopSession } from '@/lib/session';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const shop = searchParams.get('shop');
  const code = searchParams.get('code');
  const hmac = searchParams.get('hmac');

  if (!shop || !code || !hmac) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  // Verify HMAC
  if (!verifyHmac(searchParams)) {
    return NextResponse.json({ error: 'HMAC verification failed' }, { status: 403 });
  }

  try {
    // Exchange code for access token
    const { access_token, scope } = await exchangeCodeForToken(shop, code);

    // Get the store's timezone
    const timezone = await fetchShopTimezone(shop, access_token);

    // Save or update shop in database
    await prisma.shop.upsert({
      where: { domain: shop },
      update: {
        accessToken: access_token,
        scope,
        timezone,
      },
      create: {
        domain: shop,
        accessToken: access_token,
        scope,
        timezone,
      },
    });

    // Set session cookie
    await setShopSession(shop);

    // Redirect to dashboard
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}/dashboard`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}

function verifyHmac(params: URLSearchParams): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const hmac = params.get('hmac');
  if (!hmac) return false;

  // Build the message from all params except hmac
  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    if (key !== 'hmac') {
      entries.push([key, value]);
    }
  });

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const message = entries.map(([key, value]) => `${key}=${value}`).join('&');

  const computed = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmac));
}
