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

  // Debug: check path matching for specific URLs
  // Test with date range matching the user's dashboard (Jan 26 - Feb 4)
  const datasets = {
    // Top 50 landing pages by sessions to see what comes back
    top_sessions: `FROM sessions SHOW sessions, conversion_rate GROUP BY landing_page_path SINCE 2026-01-26 UNTIL 2026-02-04 LIMIT 5000`,
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

  // Post-process: find all earclear-related rows and show path matching analysis
  const topSessions = datasetResults.top_sessions as { tableData?: { rows?: Record<string, string>[] } };
  const allRows = topSessions?.tableData?.rows || [];
  results.totalLandingPages = allRows.length;

  // Find all rows containing "earclear" in the path
  const earclearRows = allRows.filter((row: Record<string, string>) =>
    String(row.landing_page_path || '').toLowerCase().includes('earclear')
  );
  results.earclearPaths = earclearRows.map((row: Record<string, string>) => ({
    path: row.landing_page_path,
    sessions: row.sessions,
    conversion_rate: row.conversion_rate,
  }));

  // Show what our matching logic would do for these target paths
  const targetPaths = ['/products/k9-earclear-v3', '/products/k9-earclear'];
  const matchingAnalysis: Record<string, unknown> = {};
  for (const target of targetPaths) {
    const normalizedTarget = target.toLowerCase();
    const matches = allRows.filter((row: Record<string, string>) => {
      const landingPath = String(row.landing_page_path || '').toLowerCase();
      return landingPath === normalizedTarget ||
        landingPath === normalizedTarget + '/' ||
        landingPath + '/' === normalizedTarget;
    });
    matchingAnalysis[target] = {
      matchCount: matches.length,
      matches: matches.map((row: Record<string, string>) => ({
        path: row.landing_page_path,
        sessions: row.sessions,
        conversion_rate: row.conversion_rate,
      })),
    };
  }
  results.matchingAnalysis = matchingAnalysis;

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
