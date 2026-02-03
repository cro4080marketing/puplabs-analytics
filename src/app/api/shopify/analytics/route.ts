import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import {
  resolveProductsFromUrls,
  fetchLandingPageData,
  fetchProductSales,
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

    // Get product titles for sales lookup
    const productTitles = urls
      .map(url => productMap.get(url)?.title)
      .filter((t): t is string => !!t);
    console.log(`[Analytics] Product titles for sales lookup: ${JSON.stringify(productTitles)}`);

    try {
      // Step 2: Fetch ShopifyQL data in parallel
      // - Landing page data: sessions + conversion_rate per landing_page_path
      // - Product sales: net_sales per product_title
      console.log('[Analytics] Fetching ShopifyQL data (sessions + sales)...');

      const [landingPageMap, salesMap] = await withTimeout(
        Promise.all([
          fetchLandingPageData(session.shop, session.accessToken, urlPaths, dateRange),
          fetchProductSales(session.shop, session.accessToken, productTitles, dateRange),
        ]),
        60000,
        'ShopifyQL queries'
      );

      console.log(`[Analytics] ShopifyQL data fetched (${Date.now() - startTime}ms)`);

      // Step 3: Build page metrics
      // Orders come from sessions × conversion_rate (matches Shopify's "Sessions that completed checkout")
      // Revenue comes from the sales dataset (net_sales per product)
      // Since sales are per-product (not per-landing-page), we pro-rate revenue:
      //   landing_page_revenue = (landing_page_orders / total_product_orders) × product_net_sales
      //   If there's only one landing page per product, it gets all the revenue.

      // First, sum up total orders across all landing pages per product title
      // so we can pro-rate revenue
      const totalOrdersByProduct = new Map<string, number>();
      for (const url of urls) {
        const product = productMap.get(url);
        if (!product) continue;
        const urlPath = normalizeUrlPath(url);
        const lpData = landingPageMap.get(urlPath);
        const orders = lpData?.orders || 0;
        const existing = totalOrdersByProduct.get(product.title) || 0;
        totalOrdersByProduct.set(product.title, existing + orders);
      }

      const pages: PageMetrics[] = urls.map((url, idx) => {
        const product = productMap.get(url);
        const urlPath = urlPaths[idx];
        const lpData = landingPageMap.get(urlPath);

        if (!product || !lpData) {
          console.log(`[Analytics] No data for "${urlPath}" — product: ${product?.title || 'unknown'}`);
          return calculatePageMetrics(
            url,
            product?.title || 'Unknown Product',
            0,
            0,
            0
          );
        }

        const { sessions, conversionRate, orders } = lpData;
        const productNetSales = salesMap.get(product.title) || 0;
        const totalProductOrders = totalOrdersByProduct.get(product.title) || 0;

        // Pro-rate revenue: this landing page's share of total product revenue
        let revenue = 0;
        if (totalProductOrders > 0 && orders > 0) {
          revenue = (orders / totalProductOrders) * productNetSales;
        }

        console.log(
          `[Analytics] ${urlPath} → "${product.title}": ` +
          `${sessions} sessions, ${(conversionRate * 100).toFixed(2)}% CVR, ` +
          `${orders} orders, $${revenue.toFixed(2)} revenue ` +
          `(product total: $${productNetSales}, ${totalProductOrders} orders across all pages)`
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
