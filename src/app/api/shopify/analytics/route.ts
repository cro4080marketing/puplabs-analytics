import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import { resolveProductsFromUrls, fetchOrders, fetchProductViewSessions } from '@/lib/shopify';
import { filterOrdersByTags, getProductOrderData, calculatePageMetrics } from '@/lib/calculations';
import { getCachedData, setCachedData, generateCacheKey, clearCache } from '@/lib/cache';
import { ComparisonRequest, ComparisonResponse, PageMetrics } from '@/types';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[Analytics] Request started');

  let session;
  try {
    session = await withTimeout(getShopSession(), 5000, 'Session lookup');
  } catch (err) {
    console.error('[Analytics] Session lookup failed:', err);
    return NextResponse.json({ error: 'Session lookup failed. Please reconnect your store.' }, { status: 500 });
  }

  if (!session) {
    console.log('[Analytics] No session found');
    return NextResponse.json({ error: 'Not authenticated. Please reconnect your store.' }, { status: 401 });
  }

  console.log(`[Analytics] Session found for shop: ${session.shop}`);

  try {
    const body: ComparisonRequest & { refresh?: boolean } = await request.json();
    const { urls, dateRange, tagFilter, refresh } = body;

    console.log(`[Analytics] Request: ${urls.length} URLs, ${dateRange.start} to ${dateRange.end}`);

    if (!urls || urls.length === 0) {
      return NextResponse.json({ error: 'At least one URL is required' }, { status: 400 });
    }

    if (!dateRange?.start || !dateRange?.end) {
      return NextResponse.json({ error: 'Date range is required' }, { status: 400 });
    }

    // Check cache unless refresh is requested
    const cacheKey = generateCacheKey({ urls, dateRange, tagFilter });

    if (!refresh) {
      try {
        const cached = await withTimeout(
          getCachedData<ComparisonResponse>(session.shopId, cacheKey),
          3000,
          'Cache lookup'
        );
        if (cached) {
          console.log(`[Analytics] Cache hit (${Date.now() - startTime}ms)`);
          return NextResponse.json(cached);
        }
      } catch (err) {
        console.warn('[Analytics] Cache lookup failed, proceeding without cache:', err);
      }
    } else {
      try {
        await clearCache(session.shopId);
      } catch (err) {
        console.warn('[Analytics] Cache clear failed:', err);
      }
    }

    // Step 1: Resolve product page URLs to actual products
    console.log('[Analytics] Resolving product URLs...');
    let productMap;
    try {
      productMap = await withTimeout(
        resolveProductsFromUrls(session.shop, session.accessToken, urls),
        15000,
        'Product resolution'
      );
    } catch (err) {
      console.error(`[Analytics] Product resolution failed (${Date.now() - startTime}ms):`, err);
      return NextResponse.json(
        { error: 'Failed to look up products. Check your URLs are valid product pages.' },
        { status: 504 }
      );
    }
    console.log(`[Analytics] Resolved ${productMap.size}/${urls.length} products`);

    // Step 2: Fetch orders and product sessions in parallel
    console.log('[Analytics] Fetching orders and product sessions...');
    const productTitles = Array.from(productMap.values()).map(p => p.title);

    let orders, sessionMap;
    try {
      [orders, sessionMap] = await withTimeout(
        Promise.all([
          fetchOrders(session.shop, session.accessToken, dateRange),
          fetchProductViewSessions(session.shop, session.accessToken, productTitles, dateRange),
        ]),
        30000,
        'Shopify API calls'
      );
    } catch (err) {
      console.error(`[Analytics] Shopify API calls failed (${Date.now() - startTime}ms):`, err);
      return NextResponse.json(
        { error: 'Shopify API request timed out. Try a shorter date range or fewer URLs.' },
        { status: 504 }
      );
    }

    console.log(`[Analytics] Got ${orders.length} orders, ${sessionMap.size} session entries (${Date.now() - startTime}ms)`);

    // Step 3: Filter orders by tags if applicable
    const filteredOrders = filterOrdersByTags(orders, tagFilter);
    console.log(`[Analytics] After tag filter: ${filteredOrders.length} orders`);

    // Step 4: Calculate metrics for each product page
    const pages: PageMetrics[] = urls.map(url => {
      const product = productMap.get(url);

      if (!product) {
        return calculatePageMetrics(url, 'Unknown Product', 0, 0, 0);
      }

      // Get orders containing this product and the full order revenue
      const { matchingOrders, totalRevenue } = getProductOrderData(filteredOrders, product.id);

      // Get sessions for this product
      const sessions = sessionMap.get(product.title) || 0;

      console.log(`[Analytics] ${url} → "${product.title}": ${sessions} sessions, ${matchingOrders.length} orders, $${totalRevenue.toFixed(2)} total revenue`);

      return calculatePageMetrics(
        url,
        product.title,
        sessions,
        totalRevenue,
        matchingOrders.length
      );
    });

    const response: ComparisonResponse = {
      pages,
      dateRange,
      tagFilter,
      lastUpdated: new Date().toISOString(),
    };

    // Cache the results (don't block response on caching)
    setCachedData(session.shopId, cacheKey, response).catch(err => {
      console.warn('[Analytics] Failed to cache results:', err);
    });

    console.log(`[Analytics] Response complete (${Date.now() - startTime}ms)`);
    return NextResponse.json(response);
  } catch (error) {
    console.error(`[Analytics] Unexpected error (${Date.now() - startTime}ms):`, error);
    const message = error instanceof Error ? error.message : 'Failed to fetch analytics data';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
