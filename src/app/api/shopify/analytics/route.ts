import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import { fetchPageSessions, fetchOrders } from '@/lib/shopify';
import { calculateComparison } from '@/lib/calculations';
import { getCachedData, setCachedData, generateCacheKey, clearCache } from '@/lib/cache';
import { ComparisonRequest, ComparisonResponse, PageMetrics } from '@/types';

export async function POST(request: NextRequest) {
  const session = await getShopSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body: ComparisonRequest & { refresh?: boolean } = await request.json();
    const { urls, dateRange, attributionMethod, tagFilter, refresh } = body;

    if (!urls || urls.length === 0) {
      return NextResponse.json({ error: 'At least one URL is required' }, { status: 400 });
    }

    if (!dateRange?.start || !dateRange?.end) {
      return NextResponse.json({ error: 'Date range is required' }, { status: 400 });
    }

    // Check cache unless refresh is requested
    const cacheKey = generateCacheKey({ urls, dateRange, attributionMethod, tagFilter });

    if (!refresh) {
      const cached = await getCachedData<ComparisonResponse>(session.shopId, cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    } else {
      await clearCache(session.shopId);
    }

    // Fetch sessions and orders in parallel
    const [sessionsData, orders] = await Promise.all([
      fetchPageSessions(session.shop, session.accessToken, urls, dateRange),
      fetchOrders(session.shop, session.accessToken, dateRange),
    ]);

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

    // Cache the results
    await setCachedData(session.shopId, cacheKey, response);

    return NextResponse.json(response);
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics data' },
      { status: 500 }
    );
  }
}
