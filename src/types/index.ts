export interface ShopSession {
  shop: string;
  accessToken: string;
}

export interface DateRange {
  start: string; // ISO date string YYYY-MM-DD
  end: string;
}

export interface UrlGroup {
  name: string;
  urls: string[];
}

export interface GroupMetrics {
  name: string;
  urls: string[];
  sessions: number;
  totalRevenue: number;
  revenuePerVisitor: number;
  conversionRate: number;
  aov: number;
  orderCount: number;
}

export interface PageMetrics {
  url: string;
  productTitle: string;
  sessions: number;
  totalRevenue: number;
  revenuePerVisitor: number;
  conversionRate: number;
  aov: number;
  orderCount: number;
}

export interface ComparisonRequest {
  urls: string[];
  dateRange: DateRange;
}

export interface ComparisonResponse {
  pages: PageMetrics[];
  dateRange: DateRange;
  lastUpdated: string;
}

export interface ShopifyLineItem {
  product_id: number;
  title: string;
  variant_title: string;
  price: string;
  quantity: number;
}

export interface ShopifyOrder {
  id: number;
  total_price: string;
  tags: string;
  created_at: string;
  cancelled_at: string | null;
  financial_status: string;
  source_name: string;
  line_items: ShopifyLineItem[];
}

export interface SessionData {
  url: string;
  sessions: number;
}
