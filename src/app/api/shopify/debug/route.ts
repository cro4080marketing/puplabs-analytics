import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';

const API_VERSION = '2026-01'; // ShopifyQL requires 2025-04+

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

  // Test 1: Check available scopes via a simple shop query
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

  // Test 2: Try ShopifyQL with the products dataset
  const shopifyqlQuery = `
    FROM products
    SHOW sum(view_sessions) AS view_sessions
    GROUP BY product_title
    SINCE -30d
    UNTIL today
    ORDER BY view_sessions DESC
    LIMIT 10
  `;

  const graphqlQuery = `
    {
      shopifyqlQuery(query: """${shopifyqlQuery}""") {
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

  try {
    const qlRes = await fetch(
      `https://${session.shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: graphqlQuery }),
      }
    );

    if (qlRes.ok) {
      const qlData = await qlRes.json();
      results.shopifyql = {
        typename: qlData.data?.shopifyqlQuery?.__typename,
        parseErrors: qlData.data?.shopifyqlQuery?.parseErrors,
        graphqlErrors: qlData.errors,
        tableData: qlData.data?.shopifyqlQuery?.tableData,
        polarisData: qlData.data?.shopifyqlQuery?.data,
        rawQuery: shopifyqlQuery.trim(),
      };
    } else {
      const errorText = await qlRes.text();
      results.shopifyqlError = `HTTP ${qlRes.status}: ${errorText}`;
    }
  } catch (err) {
    results.shopifyqlError = String(err);
  }

  // Test 3: Try a simpler ShopifyQL query without aggregation
  const simpleQuery = `
    FROM products
    SHOW product_title, view_sessions
    SINCE -7d
    UNTIL today
    LIMIT 5
  `;

  const simpleGraphql = `
    {
      shopifyqlQuery(query: """${simpleQuery}""") {
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

  try {
    const simpleRes = await fetch(
      `https://${session.shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: simpleGraphql }),
      }
    );

    if (simpleRes.ok) {
      const simpleData = await simpleRes.json();
      results.shopifyqlSimple = {
        typename: simpleData.data?.shopifyqlQuery?.__typename,
        parseErrors: simpleData.data?.shopifyqlQuery?.parseErrors,
        graphqlErrors: simpleData.errors,
        tableData: simpleData.data?.shopifyqlQuery?.tableData,
        rawQuery: simpleQuery.trim(),
      };
    } else {
      results.shopifyqlSimpleError = `HTTP ${simpleRes.status}`;
    }
  } catch (err) {
    results.shopifyqlSimpleError = String(err);
  }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
