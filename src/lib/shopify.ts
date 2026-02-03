import { DateRange } from '@/types';

const API_VERSION = '2025-01';
const SHOPIFYQL_API_VERSION = '2026-01'; // ShopifyQL requires 2025-04+ to be on QueryRoot
const FETCH_TIMEOUT = 30000; // 30 seconds per individual API call

interface ShopifyRequestOptions {
  shop: string;
  accessToken: string;
  endpoint: string;
  params?: Record<string, string>;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeout = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function shopifyRequest<T>({ shop, accessToken, endpoint, params }: ShopifyRequestOptions): Promise<T> {
  const url = new URL(`https://${shop}/admin/api/${API_VERSION}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================
// PRODUCT LOOKUP
// ============================================================

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
}

// Extract product handle from a URL path like /products/freedom-joint-drops
export function extractProductHandle(urlPath: string): string | null {
  const normalized = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  const match = normalized.match(/^\/products\/([^/?#]+)/);
  return match ? match[1] : null;
}

// Look up a product by its handle
export async function fetchProductByHandle(
  shop: string,
  accessToken: string,
  handle: string
): Promise<ShopifyProduct | null> {
  try {
    const data = await shopifyRequest<{ products: ShopifyProduct[] }>({
      shop,
      accessToken,
      endpoint: '/products.json',
      params: {
        handle,
        fields: 'id,title,handle',
        limit: '1',
      },
    });

    return data.products?.[0] || null;
  } catch (error) {
    console.error(`[Shopify] Failed to fetch product by handle "${handle}":`, error);
    return null;
  }
}

// Resolve multiple URL paths to product info
export async function resolveProductsFromUrls(
  shop: string,
  accessToken: string,
  urls: string[]
): Promise<Map<string, ShopifyProduct>> {
  const productMap = new Map<string, ShopifyProduct>();

  for (const url of urls) {
    const handle = extractProductHandle(url);
    if (!handle) {
      console.warn(`[Shopify] Could not extract product handle from URL: ${url}`);
      continue;
    }

    const product = await fetchProductByHandle(shop, accessToken, handle);
    if (product) {
      productMap.set(url, product);
      console.log(`[Shopify] Resolved "${url}" → Product #${product.id} "${product.title}"`);
    } else {
      console.warn(`[Shopify] No product found for handle: ${handle}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return productMap;
}

// ============================================================
// PER-PRODUCT ORDER DATA (GraphQL — fast, targeted)
// ============================================================

export interface ProductOrderData {
  orderCount: number;
  totalRevenue: number;
}

// Tag to exclude — Recharge subscription rebills
const REBILL_TAG = 'subscription recurring order';

// Fetch order count and total revenue for a specific product using GraphQL.
// Uses a search query to find only orders containing this product,
// then sums up the full order totals. Excludes "Subscription Recurring Order" tagged orders
// via BOTH query filter AND server-side tag check (belt and suspenders).
export async function fetchOrdersForProduct(
  shop: string,
  accessToken: string,
  productId: number,
  dateRange: DateRange
): Promise<ProductOrderData> {
  let totalRevenue = 0;
  let orderCount = 0;
  let skippedRebills = 0;
  let totalFetched = 0;
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';

    // GraphQL query: search for orders containing this product in the date range.
    // Note: -tag negation may not work reliably in Shopify's search, so we also
    // do server-side filtering below as a safety net.
    const query = `
      {
        orders(first: 100, query: "product_id:${productId} created_at:>=${dateRange.start} created_at:<=${dateRange.end}"${afterClause}) {
          edges {
            node {
              id
              name
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              tags
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    try {
      const response = await fetchWithTimeout(
        `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query }),
        },
        20000
      );

      if (!response.ok) {
        console.error(`[Shopify] GraphQL orders error: ${response.status}`);
        break;
      }

      const data = await response.json();

      if (data.errors) {
        console.error('[Shopify] GraphQL errors:', JSON.stringify(data.errors));
        break;
      }

      const edges = data.data?.orders?.edges || [];
      totalFetched += edges.length;

      for (const edge of edges) {
        const order = edge.node;
        const orderTags = (order.tags || []) as string[];

        // Server-side rebill filter: skip orders tagged "Subscription Recurring Order"
        const isRebill = orderTags.some(
          (tag: string) => tag.toLowerCase().trim() === REBILL_TAG
        );

        if (isRebill) {
          skippedRebills++;
          continue;
        }

        const amount = parseFloat(order.totalPriceSet?.shopMoney?.amount || '0');
        totalRevenue += amount;
        orderCount++;
      }

      const pageInfo = data.data?.orders?.pageInfo;
      hasMore = pageInfo?.hasNextPage === true;

      if (hasMore && edges.length > 0) {
        cursor = edges[edges.length - 1].cursor;
        // Rate limiting between pages
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`[Shopify] Failed to fetch orders for product ${productId}:`, error);
      break;
    }
  }

  console.log(`[Shopify] Product ${productId}: ${totalFetched} total orders fetched, ${skippedRebills} rebills skipped, ${orderCount} counted, $${Math.round(totalRevenue * 100) / 100} revenue`);
  return { orderCount, totalRevenue: Math.round(totalRevenue * 100) / 100 };
}

// ============================================================
// PRODUCT VIEW SESSIONS (via ShopifyQL products dataset)
// ============================================================

// Fetch sessions per landing page path using ShopifyQL sessions dataset.
// Takes URL paths (e.g. ["/products/prodenta-2", "/pages/fjd-offer-v2"])
// and returns a map of path → session count.
export async function fetchSessionsByLandingPage(
  shop: string,
  accessToken: string,
  urlPaths: string[],
  dateRange: DateRange
): Promise<Map<string, number>> {
  const sessionMap = new Map<string, number>();

  for (const path of urlPaths) {
    sessionMap.set(path, 0);
  }

  // Query the sessions dataset grouped by landing_page_path.
  // This returns all landing pages with their session counts.
  // We fetch a large LIMIT to ensure our target pages are included.
  const shopifyqlQuery = `FROM sessions SHOW sessions GROUP BY landing_page_path SINCE ${dateRange.start} UNTIL ${dateRange.end} LIMIT 1000`;

  const query = `
    {
      shopifyqlQuery(query: """${shopifyqlQuery}""") {
        tableData {
          rows
          columns {
            name
            dataType
          }
        }
        parseErrors
      }
    }
  `;

  try {
    console.log(`[Shopify] ShopifyQL sessions query for ${urlPaths.length} paths`);
    console.log(`[Shopify] Target paths: ${JSON.stringify(urlPaths)}`);

    const response = await fetchWithTimeout(
      `https://${shop}/admin/api/${SHOPIFYQL_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      },
      30000
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Shopify] ShopifyQL HTTP error ${response.status}: ${errorText}`);
      return sessionMap;
    }

    const data = await response.json();

    if (data.errors) {
      console.error('[Shopify] GraphQL errors:', JSON.stringify(data.errors));
      return sessionMap;
    }

    const qlResult = data.data?.shopifyqlQuery;

    if (qlResult?.parseErrors?.length > 0) {
      console.error('[Shopify] ShopifyQL parse errors:', JSON.stringify(qlResult.parseErrors));
      return sessionMap;
    }

    const tableData = qlResult?.tableData;
    const rows = tableData?.rows;

    if (rows && rows.length > 0) {
      console.log(`[Shopify] ShopifyQL returned ${rows.length} landing page rows`);

      // Log first 5 rows for debugging
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        console.log(`[Shopify] ShopifyQL row[${i}]: ${JSON.stringify(rows[i])}`);
      }

      // Match rows to our target URL paths
      for (const row of rows) {
        const landingPath = String(row.landing_page_path || '').toLowerCase();
        const sessions = parseInt(String(row.sessions || '0'), 10);

        for (const targetPath of urlPaths) {
          const normalizedTarget = targetPath.toLowerCase();
          // Match exact path or path with/without trailing slash
          if (
            landingPath === normalizedTarget ||
            landingPath === normalizedTarget + '/' ||
            landingPath + '/' === normalizedTarget
          ) {
            const current = sessionMap.get(targetPath) || 0;
            sessionMap.set(targetPath, current + (isNaN(sessions) ? 0 : sessions));
            console.log(`[Shopify] Matched path "${targetPath}" → ${sessions} sessions`);
          }
        }
      }

      console.log(`[Shopify] Matched ${Array.from(sessionMap.values()).filter(v => v > 0).length}/${urlPaths.length} paths with session data`);
    } else {
      console.warn('[Shopify] No rows in ShopifyQL sessions response');
    }
  } catch (error) {
    console.error('[Shopify] Failed to fetch landing page sessions:', error);
  }

  console.log(`[Shopify] Final session map: ${JSON.stringify(Object.fromEntries(sessionMap))}`);
  return sessionMap;
}

// ============================================================
// ORDER TAGS
// ============================================================

export async function fetchOrderTags(
  shop: string,
  accessToken: string
): Promise<string[]> {
  const tags = new Set<string>();

  try {
    const data = await shopifyRequest<{ orders: Array<{ tags: string }> }>({
      shop,
      accessToken,
      endpoint: '/orders.json',
      params: {
        limit: '250',
        fields: 'tags',
        status: 'any',
      },
    });

    for (const order of data.orders || []) {
      if (order.tags) {
        order.tags.split(',').forEach(tag => {
          const trimmed = tag.trim();
          if (trimmed) tags.add(trimmed);
        });
      }
    }
  } catch (error) {
    console.error('[Shopify] Failed to fetch order tags:', error);
  }

  return Array.from(tags).sort();
}

// ============================================================
// HELPERS
// ============================================================

export function normalizeUrlPath(url: string): string {
  try {
    if (url.startsWith('http')) {
      const parsed = new URL(url);
      return parsed.pathname;
    }
    return url.startsWith('/') ? url : `/${url}`;
  } catch {
    return url.startsWith('/') ? url : `/${url}`;
  }
}

export async function fetchShopTimezone(
  shop: string,
  accessToken: string
): Promise<string> {
  try {
    const data = await shopifyRequest<{ shop: { iana_timezone: string } }>({
      shop,
      accessToken,
      endpoint: '/shop.json',
      params: { fields: 'iana_timezone' },
    });
    return data.shop.iana_timezone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export function buildAuthUrl(shop: string): string {
  const apiKey = process.env.SHOPIFY_API_KEY!;
  const scopes = process.env.SHOPIFY_SCOPES || 'read_analytics,read_orders,read_products,read_reports';
  const redirectUri = `${process.env.APP_URL}/api/auth/callback`;

  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', apiKey);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('redirect_uri', redirectUri);

  return url.toString();
}

export async function exchangeCodeForToken(
  shop: string,
  code: string
): Promise<{ access_token: string; scope: string }> {
  const response = await fetchWithTimeout(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  return response.json();
}
