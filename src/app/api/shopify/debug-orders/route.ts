import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';

const API_VERSION = '2025-01';
const REBILL_TAG = 'subscription recurring order';

// Debug endpoint: show raw order data with tag info for a specific product
// GET /api/shopify/debug-orders?product_id=XXXXX&days=30
export async function GET(request: NextRequest) {
  const session = await getShopSession();

  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const productId = request.nextUrl.searchParams.get('product_id');
  const days = parseInt(request.nextUrl.searchParams.get('days') || '30', 10);

  if (!productId) {
    return NextResponse.json({
      error: 'Missing product_id parameter',
      usage: '/api/shopify/debug-orders?product_id=YOUR_PRODUCT_ID&days=30'
    }, { status: 400 });
  }

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const startDate = sinceDate.toISOString().split('T')[0];
  const endDate = new Date().toISOString().split('T')[0];

  const query = `
    {
      orders(first: 50, query: "product_id:${productId} created_at:>=${startDate} created_at:<=${endDate}") {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            tags
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;

  try {
    const response = await fetch(
      `https://${session.shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    if (!response.ok) {
      return NextResponse.json({ error: `Shopify HTTP ${response.status}` }, { status: 500 });
    }

    const data = await response.json();

    if (data.errors) {
      return NextResponse.json({ graphqlErrors: data.errors }, { status: 500 });
    }

    const edges = data.data?.orders?.edges || [];
    const hasMore = data.data?.orders?.pageInfo?.hasNextPage;

    let includedCount = 0;
    let includedRevenue = 0;
    let skippedCount = 0;
    let skippedRevenue = 0;

    const orders = edges.map((edge: { node: { id: string; name: string; createdAt: string; totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }; tags: string[] } }) => {
      const order = edge.node;
      const tags = (order.tags || []) as string[];
      const amount = parseFloat(order.totalPriceSet?.shopMoney?.amount || '0');

      const isRebill = tags.some(
        (tag: string) => tag.toLowerCase().trim() === REBILL_TAG
      );

      if (isRebill) {
        skippedCount++;
        skippedRevenue += amount;
      } else {
        includedCount++;
        includedRevenue += amount;
      }

      return {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        amount,
        tags,
        isRebill,
        matchedTag: isRebill ? tags.find((t: string) => t.toLowerCase().trim() === REBILL_TAG) : null,
      };
    });

    return NextResponse.json({
      productId,
      dateRange: { start: startDate, end: endDate },
      totalOrdersFetched: edges.length,
      hasMorePages: hasMore,
      summary: {
        included: { count: includedCount, revenue: Math.round(includedRevenue * 100) / 100 },
        skippedRebills: { count: skippedCount, revenue: Math.round(skippedRevenue * 100) / 100 },
      },
      rebillTagLookingFor: REBILL_TAG,
      orders,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
