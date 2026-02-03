import { NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';

const API_VERSION = '2025-01';

// Returns all products with their URL paths for autocomplete
// GET /api/shopify/products
export async function GET() {
  const session = await getShopSession();

  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const products: { title: string; handle: string; url: string }[] = [];
    let pageInfo: string | null = null;
    let hasMore = true;

    // Paginate through all products
    while (hasMore) {
      const params = new URLSearchParams({
        limit: '250',
        fields: 'id,title,handle',
      });
      if (pageInfo) {
        params.set('page_info', pageInfo);
      }

      const response = await fetch(
        `https://${session.shop}/admin/api/${API_VERSION}/products.json?${params}`,
        {
          headers: {
            'X-Shopify-Access-Token': session.accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status}`);
      }

      const data = await response.json();

      for (const product of data.products || []) {
        products.push({
          title: product.title,
          handle: product.handle,
          url: `/products/${product.handle}`,
        });
      }

      // Check for pagination via Link header
      const linkHeader = response.headers.get('Link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/page_info=([^>&]*)/);
        pageInfo = match ? match[1] : null;
        hasMore = !!pageInfo;
      } else {
        hasMore = false;
      }
    }

    // Sort alphabetically by title
    products.sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({ products }, {
      headers: {
        'Cache-Control': 'private, max-age=300', // cache 5 min
      },
    });
  } catch (error) {
    console.error('[Products] Failed to fetch:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
