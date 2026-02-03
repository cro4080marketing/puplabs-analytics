import { NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import { fetchOrderTags } from '@/lib/shopify';

export async function GET() {
  const session = await getShopSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const tags = await fetchOrderTags(session.shop, session.accessToken);
    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Tags fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order tags' },
      { status: 500 }
    );
  }
}
