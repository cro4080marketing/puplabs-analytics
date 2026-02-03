import { ShopifyOrder, PageMetrics, AttributionMethod, TagFilter, SessionData } from '@/types';
import { normalizeUrlPath } from './shopify';

// Filter orders by tags
export function filterOrdersByTags(
  orders: ShopifyOrder[],
  tagFilter?: TagFilter
): ShopifyOrder[] {
  if (!tagFilter || tagFilter.tags.length === 0) return orders;

  return orders.filter(order => {
    const orderTags = (order.tags || '')
      .split(',')
      .map(t => t.trim().toLowerCase());

    if (tagFilter.logic === 'AND') {
      return tagFilter.tags.every(tag =>
        orderTags.includes(tag.toLowerCase())
      );
    } else {
      return tagFilter.tags.some(tag =>
        orderTags.includes(tag.toLowerCase())
      );
    }
  });
}

// Attribute orders to page URLs based on the selected attribution method
export function attributeOrdersToUrl(
  orders: ShopifyOrder[],
  url: string,
  method: AttributionMethod
): ShopifyOrder[] {
  const normalizedPath = normalizeUrlPath(url);

  return orders.filter(order => {
    switch (method) {
      case 'landing_page': {
        if (!order.landing_site) return false;
        const landingPath = normalizeUrlPath(order.landing_site);
        return landingPath === normalizedPath || landingPath.startsWith(normalizedPath);
      }

      case 'last_page': {
        // Shopify doesn't directly provide "last page before checkout"
        // We use landing_site as the best available proxy
        if (!order.landing_site) return false;
        const landingPath = normalizeUrlPath(order.landing_site);
        return landingPath === normalizedPath || landingPath.startsWith(normalizedPath);
      }

      case 'referrer': {
        if (!order.referring_site) return false;
        try {
          const referrerPath = normalizeUrlPath(order.referring_site);
          return referrerPath === normalizedPath || referrerPath.startsWith(normalizedPath);
        } catch {
          return false;
        }
      }

      case 'utm': {
        // Check if the landing site contains UTM params that reference the page
        const landingSite = order.landing_site || '';
        const sourceUrl = order.source_url || '';
        return landingSite.includes(normalizedPath) || sourceUrl.includes(normalizedPath);
      }

      default:
        return false;
    }
  });
}

// Calculate metrics for a single page
export function calculatePageMetrics(
  url: string,
  sessions: number,
  attributedOrders: ShopifyOrder[]
): PageMetrics {
  const orderCount = attributedOrders.length;
  const totalRevenue = attributedOrders.reduce(
    (sum, order) => sum + parseFloat(order.total_price || '0'),
    0
  );

  const revenuePerVisitor = sessions > 0 ? totalRevenue / sessions : 0;
  const conversionRate = sessions > 0 ? (orderCount / sessions) * 100 : 0;
  const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

  return {
    url,
    sessions,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    revenuePerVisitor: Math.round(revenuePerVisitor * 100) / 100,
    conversionRate: Math.round(conversionRate * 100) / 100,
    aov: Math.round(aov * 100) / 100,
    orderCount,
  };
}

// Calculate metrics for all pages in a comparison
export function calculateComparison(
  urls: string[],
  sessionsData: SessionData[],
  orders: ShopifyOrder[],
  method: AttributionMethod,
  tagFilter?: TagFilter
): PageMetrics[] {
  const filteredOrders = filterOrdersByTags(orders, tagFilter);

  return urls.map(url => {
    const sessionInfo = sessionsData.find(s => s.url === url);
    const sessions = sessionInfo?.sessions || 0;
    const attributedOrders = attributeOrdersToUrl(filteredOrders, url, method);

    return calculatePageMetrics(url, sessions, attributedOrders);
  });
}
