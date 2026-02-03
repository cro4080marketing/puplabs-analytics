'use client';

import { PageMetrics } from '@/types';

interface MetricsTableProps {
  pages: PageMetrics[];
  loading: boolean;
}

interface MetricConfig {
  key: keyof PageMetrics;
  label: string;
  format: (value: number) => string;
  higherIsBetter: boolean;
}

const METRICS: MetricConfig[] = [
  { key: 'sessions', label: 'Sessions', format: (v) => v.toLocaleString(), higherIsBetter: true },
  { key: 'totalRevenue', label: 'Total Revenue', format: (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, higherIsBetter: true },
  { key: 'revenuePerVisitor', label: 'Revenue / Visitor', format: (v) => `$${v.toFixed(2)}`, higherIsBetter: true },
  { key: 'conversionRate', label: 'Conversion Rate', format: (v) => `${v.toFixed(2)}%`, higherIsBetter: true },
  { key: 'aov', label: 'AOV', format: (v) => `$${v.toFixed(2)}`, higherIsBetter: true },
  { key: 'orderCount', label: 'Orders', format: (v) => v.toLocaleString(), higherIsBetter: true },
];

function getColumnHeader(page: PageMetrics): string {
  if (page.productTitle && page.productTitle !== 'Unknown Product') {
    return page.productTitle;
  }
  return page.url;
}

export default function MetricsTable({ pages, loading }: MetricsTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
          <p className="text-sm text-gray-500">Fetching analytics data...</p>
        </div>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-20">
        <svg className="mb-3 h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-base font-medium text-gray-500">No data to display</p>
        <p className="mt-1 text-sm text-gray-400">Add product page URLs above and click &quot;Run Comparison&quot;</p>
      </div>
    );
  }

  const bestWorst = findBestWorst(pages);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
              Metric
            </th>
            {pages.map((page, i) => (
              <th key={i} className="pb-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
                <div className="max-w-[200px] truncate ml-auto" title={`${getColumnHeader(page)} (${page.url})`}>
                  {getColumnHeader(page)}
                </div>
              </th>
            ))}
            {pages.length > 1 && (
              <th className="pb-3 pl-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
                Diff
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => (
            <tr key={metric.key} className="border-b border-gray-100 last:border-0">
              <td className="py-4 pr-4 text-sm font-medium text-gray-600">
                {metric.label}
              </td>
              {pages.map((page, i) => {
                const value = page[metric.key] as number;
                const isBest = bestWorst.best[metric.key] === i;
                const isWorst = bestWorst.worst[metric.key] === i && pages.length > 1;

                return (
                  <td key={i} className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className={`text-lg font-semibold tabular-nums ${
                          isBest
                            ? 'text-green-600'
                            : isWorst
                            ? 'text-red-500'
                            : 'text-gray-900'
                        }`}
                      >
                        {metric.format(value)}
                      </span>
                      {isBest && pages.length > 1 && (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
                          Best
                        </span>
                      )}
                      {isWorst && (
                        <span className="inline-flex items-center rounded-full bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
                          Low
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
              {pages.length > 1 && (
                <td className="py-4 pl-4 text-right">
                  {renderDiff(pages, metric)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function findBestWorst(pages: PageMetrics[]): {
  best: Partial<Record<keyof PageMetrics, number>>;
  worst: Partial<Record<keyof PageMetrics, number>>;
} {
  const best: Partial<Record<keyof PageMetrics, number>> = {};
  const worst: Partial<Record<keyof PageMetrics, number>> = {};

  if (pages.length < 2) return { best, worst };

  METRICS.forEach(({ key }) => {
    let bestIdx = 0;
    let worstIdx = 0;

    pages.forEach((page, i) => {
      if ((page[key] as number) > (pages[bestIdx][key] as number)) bestIdx = i;
      if ((page[key] as number) < (pages[worstIdx][key] as number)) worstIdx = i;
    });

    if (bestIdx !== worstIdx) {
      best[key] = bestIdx;
      worst[key] = worstIdx;
    }
  });

  return { best, worst };
}

function renderDiff(pages: PageMetrics[], metric: MetricConfig) {
  if (pages.length !== 2) return <span className="text-xs text-gray-400">--</span>;

  const a = pages[0][metric.key] as number;
  const b = pages[1][metric.key] as number;

  if (a === 0 && b === 0) return <span className="text-xs text-gray-400">--</span>;

  const base = a || 1;
  const diff = ((b - a) / base) * 100;
  const isPositive = diff > 0;
  const isNeutral = diff === 0;

  return (
    <span
      className={`text-sm font-medium tabular-nums ${
        isNeutral
          ? 'text-gray-400'
          : isPositive
          ? 'text-green-600'
          : 'text-red-500'
      }`}
    >
      {isPositive ? '+' : ''}{diff.toFixed(1)}%
    </span>
  );
}
