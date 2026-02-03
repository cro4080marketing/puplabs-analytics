import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';

const API_VERSION = '2026-01'; // ShopifyQL requires 2025-04+

async function runShopifyQL(shop: string, accessToken: string, qlQuery: string) {
  const graphqlQuery = `
    {
      shopifyqlQuery(query: """${qlQuery}""") {
        tableData {
          rows
          columns {
            name
            dataType
            displayName
          }
        }
        parseErrors
      }
    }
  `;

  const res = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: graphqlQuery }),
    }
  );

  if (!res.ok) {
    return { error: `HTTP ${res.status}: ${await res.text()}` };
  }

  const data = await res.json();
  if (data.errors) {
    return { graphqlErrors: data.errors };
  }

  const ql = data.data?.shopifyqlQuery;
  return {
    parseErrors: ql?.parseErrors,
    tableData: ql?.tableData,
    rawQuery: qlQuery.trim(),
  };
}

// Diagnostic endpoint to test ShopifyQL queries directly
// GET /api/shopify/debug — tests session data and ShopifyQL access
export async function GET(request: NextRequest) {
  const session = await getShopSession();

  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Get stored scope from database
  const shopRecord = await prisma.shop.findUnique({
    where: { domain: session.shop },
    select: { scope: true, updatedAt: true },
  });

  const results: Record<string, unknown> = {
    shop: session.shop,
    timestamp: new Date().toISOString(),
    storedScope: shopRecord?.scope || 'NOT FOUND',
    tokenUpdatedAt: shopRecord?.updatedAt || 'NOT FOUND',
  };

  // Check actual granted scopes from Shopify
  try {
    const scopeRes = await fetch(
      `https://${session.shop}/admin/oauth/access_scopes.json`,
      {
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );
    if (scopeRes.ok) {
      const scopeData = await scopeRes.json();
      results.grantedScopes = scopeData.access_scopes?.map((s: { handle: string }) => s.handle) || [];
      results.hasReadReports = results.grantedScopes && (results.grantedScopes as string[]).includes('read_reports');
    } else {
      results.scopeError = `HTTP ${scopeRes.status}: ${await scopeRes.text()}`;
    }
  } catch (err) {
    results.scopeError = String(err);
  }

  // Shop info
  try {
    const shopRes = await fetch(
      `https://${session.shop}/admin/api/${API_VERSION}/shop.json?fields=name,plan_name,myshopify_domain`,
      {
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );
    if (shopRes.ok) {
      const shopData = await shopRes.json();
      results.shopInfo = shopData.shop;
    } else {
      results.shopError = `HTTP ${shopRes.status}: ${await shopRes.text()}`;
    }
  } catch (err) {
    results.shopError = String(err);
  }

  // Test: can we get sales attributed to landing pages?
  // Shopify's Page CVRs report shows "Order landing page URL" with "Total sales" + "Orders"
  // so that data MUST be joinable somehow
  const datasets = {
    // Does sales support landing_page_url?
    sales_landing_url: `FROM sales SHOW total_sales GROUP BY landing_page_url SINCE -30d UNTIL today LIMIT 10`,
    // Does sales support landing_page_path?
    sales_landing_path: `FROM sales SHOW total_sales GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 10`,
    // Does sales support page_path?
    sales_page_path: `FROM sales SHOW total_sales GROUP BY page_path SINCE -30d UNTIL today LIMIT 10`,
    // Does sales support referrer_url or referrer_path?
    sales_referrer: `FROM sales SHOW total_sales GROUP BY referrer_url SINCE -30d UNTIL today LIMIT 10`,
    // Try orders dataset
    orders_dataset: `FROM orders SHOW total_sales GROUP BY landing_page_url SINCE -30d UNTIL today LIMIT 10`,
    // Try sessions with total_sales
    sessions_sales: `FROM sessions SHOW sessions, total_sales GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 10`,
    // Try sessions with revenue
    sessions_revenue: `FROM sessions SHOW sessions, revenue GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 10`,
    // Try sessions with order_value
    sessions_order_value: `FROM sessions SHOW sessions, order_value GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 10`,
    // Try sessions with net_sales
    sessions_net_sales: `FROM sessions SHOW sessions, net_sales GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 10`,
    // Try sessions with gross_sales
    sessions_gross_sales: `FROM sessions SHOW sessions, gross_sales GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 10`,
    // Try sessions with total_orders
    sessions_total_orders: `FROM sessions SHOW sessions, total_orders GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 10`,
    // Working baseline: sessions + conversion_rate
    sessions_cvr: `FROM sessions SHOW sessions, conversion_rate GROUP BY landing_page_path SINCE -30d UNTIL today LIMIT 5`,
  };

  const datasetResults: Record<string, unknown> = {};

  // Run all dataset tests in parallel
  const entries = Object.entries(datasets);
  const promises = entries.map(async ([name, query]) => {
    try {
      const result = await runShopifyQL(session.shop, session.accessToken, query);
      return [name, result] as [string, unknown];
    } catch (err) {
      return [name, { error: String(err) }] as [string, unknown];
    }
  });

  const settled = await Promise.all(promises);
  for (const [name, result] of settled) {
    datasetResults[name] = result;
  }

  results.datasets = datasetResults;

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
