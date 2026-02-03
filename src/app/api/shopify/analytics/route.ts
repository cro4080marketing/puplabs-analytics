import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import { fetchPageSessions, fetchOrders } from '@/lib/shopify';
import { calculateComparison } from '@/lib/calculations';
import { getCachedData, setCachedData, generateCacheKey, clearCache } from '@/lib/cache';
import { ComparisonRequest, ComparisonResponse, PageMetrics } from '@/types';

// Overall route timeout - 45 seconds max
const ROUTE_TIMEOUT = 45000;

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
    const { urls, dateRange, attributionMethod, tagFilter, refresh } = body;

    console.log(`[Analytics] Request: ${urls.length} URLs, ${dateRange.start} to ${dateRange.end}, method: ${attributionMethod}`);

    if (!urls || urls.length === 0) {
      return NextResponse.json({ error: 'At least one URL is required' }, { status: 400 });
    }

    if (!dateRange?.start || !dateRange?.end) {
      return NextResponse.json({ error: 'Date range is required' }, { status: 400 });
    }

    // Check cache unless refresh is requested
    const cacheKey = generateCacheKey({ urls, dateRange, attributionMethod, tagFilter });

    if (!refresh) {
      try {
        const cached = await withTimeout(
          getCachedData<ComparisonResponse>(session.shopId, cacheKey),
          3000,
          'Cache lookup'
        );
        if (cached) {
          console.log(`[Analytics] Cache hit, returning cached data (${Date.now() - startTime}ms)`);
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

    // Fetch sessions and orders in parallel with timeout
    console.log('[Analytics] Fetching sessions and orders...');
    let sessionsData, orders;

    try {
      [sessionsData, orders] = await withTimeout(
        Promise.all([
          fetchPageSessions(session.shop, session.accessToken, urls, dateRange),
          fetchOrders(session.shop, session.accessToken, dateRange),
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

    console.log(`[Analytics] Got ${sessionsData.length} session records, ${orders.length} orders (${Date.now() - startTime}ms)`);

    // Calculate metrics
    const pages: PageMetrics[] = calculateComparison(
      urls,
      sessionsData,
      orders,
      attributionMethod,
      tagFilter
    );

    const response: ComparisonResponse = {
      pages,
      dateRange,
      attributionMethod,
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
