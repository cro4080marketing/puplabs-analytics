export interface ShopSession {
  shop: string;
  accessToken: string;
}

export interface DateRange {
  start: string; // ISO date string YYYY-MM-DD
  end: string;
}

export type TagFilterLogic = 'AND' | 'OR';

export interface TagFilter {
  tags: string[];
  logic: TagFilterLogic;
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
  tagFilter?: TagFilter;
}

export interface ComparisonResponse {
  pages: PageMetrics[];
  dateRange: DateRange;
  tagFilter?: TagFilter;
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
  line_items: ShopifyLineItem[];
}

export interface SessionData {
  url: string;
  sessions: number;
}
