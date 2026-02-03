import { ShopifyOrder, DateRange, SessionData } from '@/types';

const API_VERSION = '2024-10';
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

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
}

// Extract product handle from a URL path like /products/freedom-joint
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
    // Shopify REST API supports fetching products by handle
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
// ORDERS (with line items for product-level matching)
// ============================================================

// Fetch all orders with line_items for a given date range
export async function fetchOrders(
  shop: string,
  accessToken: string,
  dateRange: DateRange
): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let nextUrl: string | null = null;
  let isFirstRequest = true;

  while (isFirstRequest || nextUrl) {
    isFirstRequest = false;

    let requestUrl: string;

    if (nextUrl) {
      requestUrl = nextUrl;
    } else {
      const url = new URL(`https://${shop}/admin/api/${API_VERSION}/orders.json`);
      url.searchParams.set('limit', '250');
      url.searchParams.set('status', 'any');
      url.searchParams.set('fields', 'id,total_price,tags,created_at,cancelled_at,financial_status,source_name,line_items');
      url.searchParams.set('created_at_min', `${dateRange.start}T00:00:00Z`);
      url.searchParams.set('created_at_max', `${dateRange.end}T23:59:59Z`);
      requestUrl = url.toString();
    }

    try {
      const response = await fetchWithTimeout(requestUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`[Shopify] Orders API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      allOrders.push(...(data.orders || []));

      // Check for next page via Link header
      const linkHeader = response.headers.get('link');
      nextUrl = extractNextUrl(linkHeader);

      // Rate limiting: wait 500ms between requests
      if (nextUrl) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error('[Shopify] Failed to fetch orders page:', error);
      break;
    }
  }

  // Filter out Recharge subscription rebills — only keep normal Shopify checkout orders
  const filteredOrders = allOrders.filter(order => {
    const source = (order.source_name || '').toLowerCase();
    // Exclude orders created by Recharge (recurring subscription rebills)
    if (source.includes('recharge')) return false;
    return true;
  });

  console.log(`[Shopify] Fetched ${allOrders.length} total orders, ${filteredOrders.length} after excluding Recharge rebills`);
  return filteredOrders;
}

function extractNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const links = linkHeader.split(',');
  for (const link of links) {
    const parts = link.trim().split(';');
    if (parts.length === 2 && parts[1].trim().includes('rel="next"')) {
      return parts[0].trim().replace(/[<>]/g, '');
    }
  }
  return null;
}

// ============================================================
// PRODUCT VIEW SESSIONS (via ShopifyQL products dataset)
// ============================================================

// Try to get product view sessions from the ShopifyQL products dataset.
// This queries by product_title. If it fails, returns 0 (API limitation).
export async function fetchProductViewSessions(
  shop: string,
  accessToken: string,
  productTitles: string[],
  dateRange: DateRange
): Promise<Map<string, number>> {
  const sessionMap = new Map<string, number>();

  // Initialize all to 0
  for (const title of productTitles) {
    sessionMap.set(title, 0);
  }

  // Try the ShopifyQL products dataset
  const shopifyqlQuery = `
    FROM products
    SHOW product_title, view_sessions
    SINCE ${dateRange.start}
    UNTIL ${dateRange.end}
  `;

  const query = `
    {
      shopifyqlQuery(query: """${shopifyqlQuery}""") {
        __typename
        ... on TableResponse {
          tableData {
            rowData
            columns {
              name
              dataType
            }
          }
        }
        parseErrors {
          code
          message
        }
      }
    }
  `;

  try {
    console.log(`[Shopify] Querying ShopifyQL products dataset for view_sessions...`);

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
      10000
    );

    if (!response.ok) {
      console.error(`[Shopify] ShopifyQL GraphQL error: ${response.status}`);
      return sessionMap;
    }

    const data = await response.json();

    // Check for errors
    if (data.errors) {
      console.error('[Shopify] GraphQL errors:', data.errors);
      return sessionMap;
    }

    const qlResult = data.data?.shopifyqlQuery;

    if (qlResult?.parseErrors?.length > 0) {
      console.error('[Shopify] ShopifyQL parse errors:', qlResult.parseErrors);
      return sessionMap;
    }

    // Parse the table data
    const tableData = qlResult?.tableData;
    if (tableData?.rowData) {
      // Find column indices
      const columns = tableData.columns || [];
      const titleIdx = columns.findIndex((c: { name: string }) =>
        c.name === 'product_title'
      );
      const sessionsIdx = columns.findIndex((c: { name: string }) =>
        c.name === 'view_sessions'
      );

      if (titleIdx >= 0 && sessionsIdx >= 0) {
        for (const row of tableData.rowData) {
          const title = row[titleIdx];
          const sessions = parseInt(row[sessionsIdx] || '0', 10);

          // Check if this title matches any of our products (case-insensitive)
          for (const targetTitle of productTitles) {
            if (title && targetTitle.toLowerCase() === title.toLowerCase()) {
              sessionMap.set(targetTitle, isNaN(sessions) ? 0 : sessions);
            }
          }
        }
        console.log(`[Shopify] ShopifyQL returned ${tableData.rowData.length} product rows`);
      } else {
        console.warn('[Shopify] ShopifyQL columns not found. Available:', columns.map((c: { name: string }) => c.name));
      }
    } else {
      console.warn('[Shopify] No tableData in ShopifyQL response');
    }
  } catch (error) {
    console.error('[Shopify] Failed to fetch product view sessions:', error);
  }

  return sessionMap;
}

// ============================================================
// ORDER TAGS
// ============================================================

// Fetch all unique order tags from the store
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

// Normalize a URL to just the path portion
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

// Get the store's timezone
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

// Build the OAuth authorization URL
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

// Exchange the authorization code for an access token
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
