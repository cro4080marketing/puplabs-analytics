'use client';

import { useState } from 'react';

interface PageSelectorProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  maxPages?: number;
}

export default function PageSelector({ urls, onChange, maxPages = 6 }: PageSelectorProps) {
  const [inputValue, setInputValue] = useState('');

  const addUrl = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (urls.length >= maxPages) return;

    // Normalize: ensure it starts with /
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

    if (urls.includes(normalized)) {
      setInputValue('');
      return;
    }

    onChange([...urls, normalized]);
    setInputValue('');
  };

  const removeUrl = (index: number) => {
    onChange(urls.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUrl();
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter page URL path (e.g. /products/dog-food)"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={addUrl}
          disabled={urls.length >= maxPages || !inputValue.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Page
        </button>
      </div>

      {/* URL chips */}
      {urls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <div
              key={index}
              className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 border border-indigo-200"
            >
              <span className="max-w-[300px] truncate font-medium">{url}</span>
              <button
                onClick={() => removeUrl(index)}
                className="ml-1 rounded-full p-0.5 hover:bg-indigo-200 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {urls.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          {urls.length} / {maxPages} pages added
        </p>
      )}
    </div>
  );
}
