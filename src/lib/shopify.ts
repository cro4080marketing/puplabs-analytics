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
// LANDING PAGE ANALYTICS (ShopifyQL — sessions + conversion_rate)
// ============================================================

export interface LandingPageData {
  sessions: number;
  conversionRate: number;
  orders: number; // derived: Math.round(sessions * conversionRate)
}

// Helper: run a ShopifyQL query and return parsed rows
async function runShopifyQL(
  shop: string,
  accessToken: string,
  shopifyqlQuery: string
): Promise<Record<string, string>[]> {
  const query = `
    {
      shopifyqlQuery(query: """${shopifyqlQuery}""") {
        tableData {
          rows
          columns { name dataType }
        }
        parseErrors
      }
    }
  `;

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
    return [];
  }

  const data = await response.json();

  if (data.errors) {
    console.error('[Shopify] GraphQL errors:', JSON.stringify(data.errors));
    return [];
  }

  const qlResult = data.data?.shopifyqlQuery;

  if (qlResult?.parseErrors?.length > 0) {
    console.error('[Shopify] ShopifyQL parse errors:', JSON.stringify(qlResult.parseErrors));
    return [];
  }

  return qlResult?.tableData?.rows || [];
}

// Fetch sessions + conversion_rate per landing page path.
// Returns a map of path → { sessions, conversionRate, orders }
export async function fetchLandingPageData(
  shop: string,
  accessToken: string,
  urlPaths: string[],
  dateRange: DateRange
): Promise<Map<string, LandingPageData>> {
  const resultMap = new Map<string, LandingPageData>();

  for (const path of urlPaths) {
    resultMap.set(path, { sessions: 0, conversionRate: 0, orders: 0 });
  }

  const shopifyqlQuery = `FROM sessions SHOW sessions, conversion_rate GROUP BY landing_page_path SINCE ${dateRange.start} UNTIL ${dateRange.end} LIMIT 1000`;

  try {
    console.log(`[Shopify] ShopifyQL sessions+conversion query for ${urlPaths.length} paths`);
    const rows = await runShopifyQL(shop, accessToken, shopifyqlQuery);
    console.log(`[Shopify] ShopifyQL returned ${rows.length} landing page rows`);

    for (const row of rows) {
      const landingPath = String(row.landing_page_path || '').toLowerCase();
      const sessions = parseInt(String(row.sessions || '0'), 10);
      const conversionRate = parseFloat(String(row.conversion_rate || '0'));

      for (const targetPath of urlPaths) {
        const normalizedTarget = targetPath.toLowerCase();
        if (landingPath === normalizedTarget) {
          const orders = Math.round(sessions * conversionRate);
          resultMap.set(targetPath, { sessions, conversionRate, orders });
          console.log(`[Shopify] Matched "${targetPath}" → ${sessions} sessions, ${(conversionRate * 100).toFixed(2)}% CVR, ${orders} orders`);
        }
      }
    }
  } catch (error) {
    console.error('[Shopify] Failed to fetch landing page data:', error);
  }

  console.log(`[Shopify] Final landing page data: ${JSON.stringify(Object.fromEntries(resultMap))}`);
  return resultMap;
}

// ============================================================
// PRODUCT AOV (ShopifyQL — total_sales ÷ orders per product_id)
// ============================================================

export interface ProductSalesData {
  totalSales: number;
  orders: number;
  aov: number; // totalSales / orders
}

// Fetch total_sales + orders per product_id from the sales dataset.
// Uses product_id (not title) because multiple products can share the same title
// but have different IDs and very different AOVs.
// Returns a map of product_id (number) → { totalSales, orders, aov }
export async function fetchProductAOV(
  shop: string,
  accessToken: string,
  productIds: number[],
  dateRange: DateRange
): Promise<Map<number, ProductSalesData>> {
  const resultMap = new Map<number, ProductSalesData>();

  for (const id of productIds) {
    resultMap.set(id, { totalSales: 0, orders: 0, aov: 0 });
  }

  const shopifyqlQuery = `FROM sales SHOW total_sales, orders GROUP BY product_id SINCE ${dateRange.start} UNTIL ${dateRange.end} LIMIT 1000`;

  try {
    console.log(`[Shopify] ShopifyQL sales+orders by product_id for ${productIds.length} products`);
    const rows = await runShopifyQL(shop, accessToken, shopifyqlQuery);
    console.log(`[Shopify] ShopifyQL sales returned ${rows.length} product rows`);

    for (const row of rows) {
      const rowProductId = parseInt(String(row.product_id || '0'), 10);
      const totalSales = parseFloat(String(row.total_sales || '0'));
      const orders = parseInt(String(row.orders || '0'), 10);
      const aov = orders > 0 ? totalSales / orders : 0;

      if (productIds.includes(rowProductId)) {
        resultMap.set(rowProductId, {
          totalSales: Math.round(totalSales * 100) / 100,
          orders,
          aov: Math.round(aov * 100) / 100,
        });
        console.log(`[Shopify] Matched product_id ${rowProductId} → $${totalSales.toFixed(2)} / ${orders} orders = $${aov.toFixed(2)} AOV`);
      }
    }
  } catch (error) {
    console.error('[Shopify] Failed to fetch product AOV:', error);
  }

  return resultMap;
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
