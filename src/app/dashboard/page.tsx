'use client';

import { useState, useCallback } from 'react';
import { format, subDays } from 'date-fns';
import DateRangePicker from '@/components/DateRangePicker';
import PageSelector from '@/components/PageSelector';
import MetricsTable from '@/components/MetricsTable';
import ExportButton from '@/components/ExportButton';
import { aggregateGroupMetrics } from '@/lib/calculations';
import {
  DateRange,
  UrlGroup,
  GroupMetrics,
} from '@/types';

export default function DashboardPage() {
  const [dateRange, setDateRange] = useState<DateRange>({
    start: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd'),
  });
  const [groupA, setGroupA] = useState<UrlGroup>({ name: 'Group A', urls: [] });
  const [groupB, setGroupB] = useState<UrlGroup>({ name: 'Group B', urls: [] });
  const [groups, setGroups] = useState<GroupMetrics[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allUrls = [...new Set([...groupA.urls, ...groupB.urls])];

  const runComparison = useCallback(async (refresh = false) => {
    const combined = [...new Set([...groupA.urls, ...groupB.urls])];
    if (groupA.urls.length === 0 || groupB.urls.length === 0) {
      setError('Add at least one product URL to each group');
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch('/api/shopify/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: combined,
          dateRange,
          refresh,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/';
          return;
        }
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Request failed (${response.status})`);
      }

      const data = await response.json();
      const aggregated = [
        aggregateGroupMetrics(groupA.name, groupA.urls, data.pages),
        aggregateGroupMetrics(groupB.name, groupB.urls, data.pages),
      ];
      setGroups(aggregated);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      clearTimeout(timeout);
      console.error('Comparison error:', err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Request timed out. Try a shorter date range or fewer URLs.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to fetch analytics data. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [groupA, groupB, dateRange]);

  const clearComparison = () => {
    setGroups([]);
    setGroupA({ name: 'Group A', urls: [] });
    setGroupB({ name: 'Group B', urls: [] });
    setLastUpdated(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">
              PL
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">PupLabs Analytics</h1>
              <p className="text-xs text-gray-400">Product Page Performance</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ExportButton
              groups={groups}
              dateRange={dateRange}
              disabled={groups.length === 0}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Controls card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* Row 1: Date range */}
          <div className="flex flex-wrap items-center gap-4">
            <DateRangePicker dateRange={dateRange} onChange={setDateRange} />
          </div>

          {/* Row 2: URL Groups */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Group A */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <input
                    type="text"
                    value={groupA.name}
                    onChange={(e) => setGroupA(prev => ({ ...prev, name: e.target.value }))}
                    className="text-sm font-semibold text-indigo-700 bg-transparent border-none focus:outline-none focus:ring-0 p-0 w-32"
                  />
                  <span className="text-xs text-indigo-400">{groupA.urls.length} page{groupA.urls.length !== 1 ? 's' : ''}</span>
                </div>
                <PageSelector
                  urls={groupA.urls}
                  onChange={(urls) => setGroupA(prev => ({ ...prev, urls }))}
                  maxPages={10}
                />
              </div>

              {/* Group B */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <input
                    type="text"
                    value={groupB.name}
                    onChange={(e) => setGroupB(prev => ({ ...prev, name: e.target.value }))}
                    className="text-sm font-semibold text-amber-700 bg-transparent border-none focus:outline-none focus:ring-0 p-0 w-32"
                  />
                  <span className="text-xs text-amber-400">{groupB.urls.length} page{groupB.urls.length !== 1 ? 's' : ''}</span>
                </div>
                <PageSelector
                  urls={groupB.urls}
                  onChange={(urls) => setGroupB(prev => ({ ...prev, urls }))}
                  maxPages={10}
                />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-4">
            <button
              onClick={() => runComparison(false)}
              disabled={loading || allUrls.length === 0}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-colors"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-white" />
                  Analyzing...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Run Comparison
                </>
              )}
            </button>

            {groups.length > 0 && (
              <>
                <button
                  onClick={() => runComparison(true)}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Data
                </button>

                <button
                  onClick={clearComparison}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-300 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear & Reset
                </button>
              </>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Results card */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <MetricsTable groups={groups} loading={loading} />
        </div>

        {/* Footer */}
        {lastUpdated && (
          <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
            <span>Last updated: {new Date(lastUpdated).toLocaleString()}</span>
            <span>Sessions data may be delayed 24-48 hours per Shopify Analytics</span>
          </div>
        )}
      </main>
    </div>
  );
}
