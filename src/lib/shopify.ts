import { ShopifyOrder, DateRange, SessionData } from '@/types';

const API_VERSION = '2024-01';

interface ShopifyRequestOptions {
  shop: string;
  accessToken: string;
  endpoint: string;
  params?: Record<string, string>;
}

async function shopifyRequest<T>({ shop, accessToken, endpoint, params }: ShopifyRequestOptions): Promise<T> {
  const url = new URL(`https://${shop}/admin/api/${API_VERSION}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), {
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
  let pageInfo: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const params: Record<string, string> = {
      limit: '250',
      status: 'any',
      fields: 'id,total_price,tags,created_at,landing_site,referring_site,source_url,cancelled_at,financial_status',
      created_at_min: `${dateRange.start}T00:00:00Z`,
      created_at_max: `${dateRange.end}T23:59:59Z`,
    };

    let endpoint = '/orders.json';

    if (pageInfo) {
      // For cursor-based pagination, use page_info
      const url = new URL(`https://${shop}/admin/api/${API_VERSION}/orders.json`);
      url.searchParams.set('limit', '250');
      url.searchParams.set('page_info', pageInfo);

      const response = await fetch(url.toString(), {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Shopify API error ${response.status}`);
      }

      const data = await response.json();
      allOrders.push(...(data.orders || []));

      // Check for next page via Link header
      const linkHeader = response.headers.get('link');
      pageInfo = extractNextPageInfo(linkHeader);
      hasNextPage = !!pageInfo;
    } else {
      const data = await shopifyRequest<{ orders: ShopifyOrder[] }>({
        shop,
        accessToken,
        endpoint,
        params,
      });

      allOrders.push(...(data.orders || []));

      // For first request, we need to check the raw response for pagination
      // Re-fetch to get headers
      const url = new URL(`https://${shop}/admin/api/${API_VERSION}/orders.json`);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      // We already have the data, just check if we got a full page
      if ((data.orders || []).length < 250) {
        hasNextPage = false;
      } else {
        // Need to re-fetch to get Link header for pagination
        const response = await fetch(url.toString(), {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        });
        const linkHeader = response.headers.get('link');
        pageInfo = extractNextPageInfo(linkHeader);
        hasNextPage = !!pageInfo;
      }
    }

    // Rate limiting: wait 500ms between requests
    if (hasNextPage) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return allOrders;
}

function extractNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const links = linkHeader.split(',');
  for (const link of links) {
    const parts = link.trim().split(';');
    if (parts.length === 2 && parts[1].trim().includes('rel="next"')) {
      const url = parts[0].trim().replace(/[<>]/g, '');
      const urlObj = new URL(url);
      return urlObj.searchParams.get('page_info');
    }
  }
  return null;
}

// Fetch session/page view data using Shopify's analytics
// Note: Shopify's REST Analytics API is limited. We use a GraphQL approach for page views.
export async function fetchPageSessions(
  shop: string,
  accessToken: string,
  urls: string[],
  dateRange: DateRange
): Promise<SessionData[]> {
  // Shopify's REST Analytics API doesn't provide page-level session data directly.
  // We'll use the GraphQL Admin API with shopifyqlQuery for this.
  const results: SessionData[] = [];

  for (const url of urls) {
    const urlPath = normalizeUrlPath(url);

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
      const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        console.error(`GraphQL error for ${urlPath}: ${response.status}`);
        results.push({ url, sessions: 0 });
        continue;
      }

      const data = await response.json();

      if (data.data?.shopifyqlQuery?.tableData?.rowData?.[0]) {
        const sessionCount = parseInt(data.data.shopifyqlQuery.tableData.rowData[0][0] || '0', 10);
        results.push({ url, sessions: sessionCount });
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

  // Fetch recent orders to collect tags
  const params: Record<string, string> = {
    limit: '250',
    fields: 'tags',
    status: 'any',
  };

  const data = await shopifyRequest<{ orders: Array<{ tags: string }> }>({
    shop,
    accessToken,
    endpoint: '/orders.json',
    params,
  });

  for (const order of data.orders || []) {
    if (order.tags) {
      order.tags.split(',').forEach(tag => {
        const trimmed = tag.trim();
        if (trimmed) tags.add(trimmed);
      });
    }
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
    // Already a path
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
  const data = await shopifyRequest<{ shop: { iana_timezone: string } }>({
    shop,
    accessToken,
    endpoint: '/shop.json',
    params: { fields: 'iana_timezone' },
  });

  return data.shop.iana_timezone || 'America/New_York';
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
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
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
