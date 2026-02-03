import { ShopifyOrder, PageMetrics, TagFilter, ShopifyLineItem } from '@/types';

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

// Find all orders that contain a specific product and calculate product-level revenue
export function getProductOrderData(
  orders: ShopifyOrder[],
  productId: number
): { matchingOrders: ShopifyOrder[]; productRevenue: number } {
  let productRevenue = 0;
  const matchingOrders: ShopifyOrder[] = [];

  for (const order of orders) {
    if (!order.line_items) continue;

    // Check if any line item matches this product
    const matchingItems = order.line_items.filter(
      (item: ShopifyLineItem) => item.product_id === productId
    );

    if (matchingItems.length > 0) {
      matchingOrders.push(order);

      // Sum up revenue from this product's line items only
      for (const item of matchingItems) {
        const itemRevenue = parseFloat(item.price || '0') * (item.quantity || 1);
        productRevenue += itemRevenue;
      }
    }
  }

  return { matchingOrders, productRevenue };
}

// Calculate metrics for a single product page
export function calculatePageMetrics(
  url: string,
  productTitle: string,
  sessions: number,
  productRevenue: number,
  orderCount: number
): PageMetrics {
  const revenuePerVisitor = sessions > 0 ? productRevenue / sessions : 0;
  const conversionRate = sessions > 0 ? (orderCount / sessions) * 100 : 0;
  const aov = orderCount > 0 ? productRevenue / orderCount : 0;

  return {
    url,
    productTitle,
    sessions,
    totalRevenue: Math.round(productRevenue * 100) / 100,
    revenuePerVisitor: Math.round(revenuePerVisitor * 100) / 100,
    conversionRate: Math.round(conversionRate * 100) / 100,
    aov: Math.round(aov * 100) / 100,
    orderCount,
  };
}
