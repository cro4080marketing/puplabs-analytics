'use client';

import { useState } from 'react';

export default function Home() {
  const [shop, setShop] = useState('puplabsco.myshopify.com');
  const [loading, setLoading] = useState(false);

  const handleInstall = () => {
    if (!shop.endsWith('.myshopify.com')) {
      alert('Please enter a valid Shopify store domain (e.g., store.myshopify.com)');
      return;
    }
    setLoading(true);
    window.location.href = `/api/auth?shop=${encodeURIComponent(shop)}`;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-600 text-white text-xl font-bold">
            PL
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">PupLabs Analytics</h1>
          <p className="mt-2 text-sm text-gray-500">
            Compare product page performance with real Shopify data
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Store Domain
            </label>
            <input
              type="text"
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              placeholder="your-store.myshopify.com"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            onClick={handleInstall}
            disabled={loading || !shop}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-colors"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-white" />
                Connecting...
              </>
            ) : (
              'Connect to Shopify'
            )}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          This will redirect you to Shopify to authorize the app.
          <br />
          We only request read access to your analytics, orders, and products.
        </p>
      </div>
    </div>
  );
}
