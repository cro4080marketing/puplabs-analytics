import { ShopifyOrder, DateRange, SessionData } from '@/types';

const API_VERSION = '2024-10';
const FETCH_TIMEOUT = 15000; // 15 seconds

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

// Fetch all orders with pagination for a given date range
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
      url.searchParams.set('fields', 'id,total_price,tags,created_at,landing_site,referring_site,source_url,cancelled_at,financial_status');
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
        console.error(`Shopify orders API error: ${response.status}`);
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
      console.error('Failed to fetch orders page:', error);
      break;
    }
  }

  return allOrders;
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

// Fetch session/page view data using Shopify's GraphQL Admin API
export async function fetchPageSessions(
  shop: string,
  accessToken: string,
  urls: string[],
  dateRange: DateRange
): Promise<SessionData[]> {
  const results: SessionData[] = [];

  for (const url of urls) {
    const urlPath = normalizeUrlPath(url);

    // Use ShopifyQL via GraphQL to get session data
    const query = `
      {
        shopifyqlQuery(query: """
          FROM sessions
          WHERE session_landing_page_path = '${urlPath}'
          AND session_started_at >= '${dateRange.start}'
          AND session_started_at <= '${dateRange.end}'
          SHOW sum(sessions) AS sessions
        """) {
          __typename
          ... on TableResponse {
            tableData {
              rowData
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
        10000 // 10s timeout for GraphQL
      );

      if (!response.ok) {
        console.error(`GraphQL error for ${urlPath}: ${response.status}`);
        results.push({ url, sessions: 0 });
        continue;
      }

      const data = await response.json();

      if (data.errors) {
        console.error(`GraphQL query errors for ${urlPath}:`, data.errors);
        results.push({ url, sessions: 0 });
        continue;
      }

      if (data.data?.shopifyqlQuery?.parseErrors?.length > 0) {
        console.error(`ShopifyQL parse errors for ${urlPath}:`, data.data.shopifyqlQuery.parseErrors);
        results.push({ url, sessions: 0 });
        continue;
      }

      if (data.data?.shopifyqlQuery?.tableData?.rowData?.[0]) {
        const sessionCount = parseInt(data.data.shopifyqlQuery.tableData.rowData[0][0] || '0', 10);
        results.push({ url, sessions: isNaN(sessionCount) ? 0 : sessionCount });
      } else {
        results.push({ url, sessions: 0 });
      }
    } catch (error) {
      console.error(`Failed to fetch sessions for ${urlPath}:`, error);
      results.push({ url, sessions: 0 });
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return results;
}

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
    console.error('Failed to fetch order tags:', error);
  }

  return Array.from(tags).sort();
}

// Normalize a URL to just the path portion for matching
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
  const scopes = process.env.SHOPIFY_SCOPES || 'read_analytics,read_orders,read_products';
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
