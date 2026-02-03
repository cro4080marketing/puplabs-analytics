import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import {
  resolveProductsFromUrls,
  fetchLandingPageData,
  fetchRevenueForProduct,
  normalizeUrlPath,
} from '@/lib/shopify';
import { calculatePageMetrics } from '@/lib/calculations';
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

    // Step 1: Resolve product page URLs to actual products (for titles)
    console.log('[Analytics] Resolving product URLs...');
    let productMap;
    try {
      productMap = await withTimeout(
        resolveProductsFromUrls(session.shop, session.accessToken, urls),
        30000,
        'Product resolution'
      );
    } catch (err) {
      console.error(`[Analytics] Product resolution failed (${Date.now() - startTime}ms):`, err);
      return NextResponse.json(
        { error: 'Failed to look up products. Check your URLs are valid product pages.' },
        { status: 504 }
      );
    }
    console.log(`[Analytics] Resolved ${productMap.size}/${urls.length} products (${Date.now() - startTime}ms)`);

    // Get URL paths for ShopifyQL lookup
    const urlPaths = urls.map(url => normalizeUrlPath(url));
    console.log(`[Analytics] URL paths: ${JSON.stringify(urlPaths)}`);

    try {
      // Step 2: Fetch sessions + conversion_rate from ShopifyQL
      console.log('[Analytics] Fetching ShopifyQL session data...');

      const landingPageMap = await withTimeout(
        fetchLandingPageData(session.shop, session.accessToken, urlPaths, dateRange),
        60000,
        'ShopifyQL sessions query'
      );

      console.log(`[Analytics] ShopifyQL data fetched (${Date.now() - startTime}ms)`);

      // Step 3: For each URL, fetch revenue via GraphQL (first-purchase orders capped to ShopifyQL order count)
      // This is the hybrid approach:
      //   - Orders count comes from ShopifyQL (sessions × CVR) — matches Shopify's report
      //   - Revenue comes from GraphQL first-purchase orders, capped to that count
      console.log('[Analytics] Fetching revenue per product via GraphQL...');

      const revenuePromises = urls.map(async (url, idx) => {
        const product = productMap.get(url);
        const urlPath = urlPaths[idx];
        const lpData = landingPageMap.get(urlPath);

        if (!product || !lpData || lpData.orders === 0) {
          return { url, product, lpData, revenue: 0, ordersFound: 0 };
        }

        const { totalRevenue, ordersFound } = await fetchRevenueForProduct(
          session.shop, session.accessToken, product.id, dateRange, lpData.orders
        );

        return { url, product, lpData, revenue: totalRevenue, ordersFound };
      });

      const revenueResults = await withTimeout(
        Promise.all(revenuePromises),
        90000,
        'GraphQL revenue queries'
      );

      // Step 4: Build page metrics
      const pages: PageMetrics[] = revenueResults.map(({ url, product, lpData, revenue, ordersFound }) => {
        if (!product || !lpData) {
          return calculatePageMetrics(url, product?.title || 'Unknown Product', 0, 0, 0);
        }

        const { sessions, conversionRate, orders } = lpData;

        console.log(
          `[Analytics] ${normalizeUrlPath(url)} → "${product.title}": ` +
          `${sessions} sessions, ${(conversionRate * 100).toFixed(2)}% CVR, ` +
          `${orders} orders (ShopifyQL), $${revenue.toFixed(2)} revenue (${ordersFound} first-purchase orders via GraphQL)`
        );

        return calculatePageMetrics(url, product.title, sessions, revenue, orders);
      });

      console.log(`[Analytics] All pages processed (${Date.now() - startTime}ms)`);

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

    } catch (err) {
      console.error(`[Analytics] ShopifyQL queries failed (${Date.now() - startTime}ms):`, err);
      return NextResponse.json(
        { error: 'Shopify API request timed out. Try a shorter date range or fewer URLs.' },
        { status: 504 }
      );
    }
  } catch (error) {
    console.error(`[Analytics] Unexpected error (${Date.now() - startTime}ms):`, error);
    const message = error instanceof Error ? error.message : 'Failed to fetch analytics data';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
