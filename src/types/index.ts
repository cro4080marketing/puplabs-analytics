export interface ShopSession {
  shop: string;
  accessToken: string;
}

export interface DateRange {
  start: string; // ISO date string YYYY-MM-DD
  end: string;
}

export type AttributionMethod = 'landing_page' | 'last_page' | 'referrer' | 'utm';

export type TagFilterLogic = 'AND' | 'OR';

export interface TagFilter {
  tags: string[];
  logic: TagFilterLogic;
}

export interface PageMetrics {
  url: string;
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
  attributionMethod: AttributionMethod;
  tagFilter?: TagFilter;
}

export interface ComparisonResponse {
  pages: PageMetrics[];
  dateRange: DateRange;
  attributionMethod: AttributionMethod;
  tagFilter?: TagFilter;
  lastUpdated: string;
}

export interface ShopifyOrder {
  id: number;
  total_price: string;
  tags: string;
  created_at: string;
  landing_site: string | null;
  referring_site: string | null;
  source_url: string | null;
  cancelled_at: string | null;
  financial_status: string;
  line_items?: Array<{
    product_id: number;
    title: string;
    variant_title: string;
  }>;
}

export interface SessionData {
  url: string;
  sessions: number;
}
