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

  // Test: can we group sales by product_id instead of product_title?
  // Also test product_variant_id, product_handle, product_url
  const datasets = {
    // GROUP BY product_id?
    sales_by_product_id: `FROM sales SHOW total_sales, orders GROUP BY product_id SINCE -30d UNTIL today LIMIT 10`,
    // GROUP BY product_variant_id?
    sales_by_variant_id: `FROM sales SHOW total_sales, orders GROUP BY product_variant_id SINCE -30d UNTIL today LIMIT 10`,
    // GROUP BY product_handle?
    sales_by_handle: `FROM sales SHOW total_sales, orders GROUP BY product_handle SINCE -30d UNTIL today LIMIT 10`,
    // GROUP BY product_url?
    sales_by_url: `FROM sales SHOW total_sales, orders GROUP BY product_url SINCE -30d UNTIL today LIMIT 10`,
    // GROUP BY product_type?
    sales_by_type: `FROM sales SHOW total_sales, orders GROUP BY product_type SINCE -30d UNTIL today LIMIT 10`,
    // GROUP BY both product_id and product_title to see the mapping?
    sales_id_and_title: `FROM sales SHOW total_sales, orders GROUP BY product_id, product_title SINCE -30d UNTIL today LIMIT 20`,
    // Working baseline
    sales_by_title: `FROM sales SHOW total_sales, orders GROUP BY product_title SINCE -30d UNTIL today LIMIT 10`,
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
