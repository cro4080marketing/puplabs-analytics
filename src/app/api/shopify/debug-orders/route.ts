import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';

const API_VERSION = '2025-01';

// Debug endpoint: show raw order data with customer order count for filtering
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
            customer {
              numberOfOrders
              firstName
              lastName
            }
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

    let firstTimeCount = 0;
    let firstTimeRevenue = 0;
    let repeatCount = 0;
    let repeatRevenue = 0;

    const orders = edges.map((edge: { node: { id: string; name: string; createdAt: string; totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }; tags: string[]; customer: { numberOfOrders: string; firstName: string; lastName: string } | null } }) => {
      const order = edge.node;
      const tags = (order.tags || []) as string[];
      const amount = parseFloat(order.totalPriceSet?.shopMoney?.amount || '0');
      const customerOrderCount = parseInt(order.customer?.numberOfOrders || '0', 10);
      const isFirstTime = customerOrderCount === 1;

      if (isFirstTime) {
        firstTimeCount++;
        firstTimeRevenue += amount;
      } else {
        repeatCount++;
        repeatRevenue += amount;
      }

      return {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        amount,
        tags,
        customerOrderCount,
        isFirstTime,
        customerName: order.customer ? `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() : 'Guest',
      };
    });

    return NextResponse.json({
      productId,
      dateRange: { start: startDate, end: endDate },
      totalOrdersFetched: edges.length,
      hasMorePages: hasMore,
      filterMethod: 'customer.numberOfOrders === 1 (first-time purchase only)',
      summary: {
        firstTimePurchases: { count: firstTimeCount, revenue: Math.round(firstTimeRevenue * 100) / 100 },
        repeatCustomers: { count: repeatCount, revenue: Math.round(repeatRevenue * 100) / 100 },
      },
      orders,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
