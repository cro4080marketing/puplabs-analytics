import { ShopifyOrder, PageMetrics, GroupMetrics, ShopifyLineItem } from '@/types';

// Find all orders that contain a specific product and calculate total order revenue
// Revenue uses the FULL order total (not just the product line item) so AOV
// reflects the real average cart value for customers who bought this product.
export function getProductOrderData(
  orders: ShopifyOrder[],
  productId: number
): { matchingOrders: ShopifyOrder[]; totalRevenue: number } {
  let totalRevenue = 0;
  const matchingOrders: ShopifyOrder[] = [];

  for (const order of orders) {
    if (!order.line_items) continue;

    // Check if any line item matches this product
    const hasProduct = order.line_items.some(
      (item: ShopifyLineItem) => item.product_id === productId
    );

    if (hasProduct) {
      matchingOrders.push(order);
      // Use the FULL order total — this is what matters for AOV
      totalRevenue += parseFloat(order.total_price || '0');
    }
  }

  return { matchingOrders, totalRevenue };
}

// Aggregate metrics across multiple pages into a single group
export function aggregateGroupMetrics(
  name: string,
  urls: string[],
  pageMetrics: PageMetrics[]
): GroupMetrics {
  const matching = pageMetrics.filter(p => urls.includes(p.url));

  const sessions = matching.reduce((sum, p) => sum + p.sessions, 0);
  const totalRevenue = matching.reduce((sum, p) => sum + p.totalRevenue, 0);
  const orderCount = matching.reduce((sum, p) => sum + p.orderCount, 0);

  const revenuePerVisitor = sessions > 0 ? totalRevenue / sessions : 0;
  const conversionRate = sessions > 0 ? (orderCount / sessions) * 100 : 0;
  const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

  return {
    name,
    urls,
    sessions,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    revenuePerVisitor: Math.round(revenuePerVisitor * 100) / 100,
    conversionRate: Math.round(conversionRate * 100) / 100,
    aov: Math.round(aov * 100) / 100,
    orderCount,
  };
}

// Calculate metrics for a single product page
// totalRevenue = sum of full order totals (not just line item revenue)
// AOV = totalRevenue / orderCount = average cart value for these orders
export function calculatePageMetrics(
  url: string,
  productTitle: string,
  sessions: number,
  totalRevenue: number,
  orderCount: number
): PageMetrics {
  const revenuePerVisitor = sessions > 0 ? totalRevenue / sessions : 0;
  const conversionRate = sessions > 0 ? (orderCount / sessions) * 100 : 0;
  const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

  return {
    url,
    productTitle,
    sessions,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    revenuePerVisitor: Math.round(revenuePerVisitor * 100) / 100,
    conversionRate: Math.round(conversionRate * 100) / 100,
    aov: Math.round(aov * 100) / 100,
    orderCount,
  };
}
