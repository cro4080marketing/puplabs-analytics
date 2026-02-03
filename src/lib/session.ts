import { cookies } from 'next/headers';
import { prisma } from './prisma';

const SESSION_COOKIE = 'puplabs_shop';

export async function getShopSession() {
  const cookieStore = await cookies();
  const shopDomain = cookieStore.get(SESSION_COOKIE)?.value;

  if (!shopDomain) return null;

  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
  });

  if (!shop) return null;

  return {
    shop: shop.domain,
    accessToken: shop.accessToken,
    shopId: shop.id,
    timezone: shop.timezone,
  };
}

export async function setShopSession(shopDomain: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, shopDomain, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
}
