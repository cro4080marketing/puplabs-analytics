'use client';

import { useState, useEffect, useRef } from 'react';

interface ProductSuggestion {
  title: string;
  handle: string;
  url: string;
}

interface PageSelectorProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  maxPages?: number;
}

export default function PageSelector({ urls, onChange, maxPages = 6 }: PageSelectorProps) {
  const [inputValue, setInputValue] = useState('');
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<ProductSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch products on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingProducts(true);

    fetch('/api/shopify/products')
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data.products) {
          setProducts(data.products);
        }
      })
      .catch(err => console.error('Failed to load products:', err))
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Filter products as user types
  useEffect(() => {
    if (!inputValue.trim()) {
      setFilteredProducts([]);
      setShowDropdown(false);
      return;
    }

    const query = inputValue.toLowerCase();
    const filtered = products
      .filter(p =>
        !urls.includes(p.url) && (
          p.title.toLowerCase().includes(query) ||
          p.handle.toLowerCase().includes(query) ||
          p.url.toLowerCase().includes(query)
        )
      )
      .slice(0, 8); // Show max 8 suggestions

    setFilteredProducts(filtered);
    setShowDropdown(filtered.length > 0);
    setHighlightIndex(-1);
  }, [inputValue, products, urls]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectProduct = (product: ProductSuggestion) => {
    if (urls.length >= maxPages) return;
    if (urls.includes(product.url)) return;

    onChange([...urls, product.url]);
    setInputValue('');
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const addUrl = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (urls.length >= maxPages) return;

    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

    if (urls.includes(normalized)) {
      setInputValue('');
      return;
    }

    onChange([...urls, normalized]);
    setInputValue('');
    setShowDropdown(false);
  };

  const removeUrl = (index: number) => {
    onChange(urls.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showDropdown && filteredProducts.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex(prev =>
          prev < filteredProducts.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex(prev =>
          prev > 0 ? prev - 1 : filteredProducts.length - 1
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < filteredProducts.length) {
          selectProduct(filteredProducts[highlightIndex]);
        } else {
          addUrl();
        }
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addUrl();
    }
  };

  // Find product title for a URL (for display in chips)
  const getProductTitle = (url: string): string | null => {
    const product = products.find(p => p.url === url);
    return product?.title || null;
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1" ref={dropdownRef}>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (inputValue.trim() && filteredProducts.length > 0) {
                setShowDropdown(true);
              }
            }}
            placeholder={loadingProducts ? 'Loading products...' : 'Search by product name or URL path...'}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />

          {/* Autocomplete dropdown */}
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {filteredProducts.map((product, index) => (
                <button
                  key={product.url}
                  onClick={() => selectProduct(product)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                    index === highlightIndex
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium truncate">{product.title}</div>
                  <div className="text-xs text-gray-400 truncate">{product.url}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={addUrl}
          disabled={urls.length >= maxPages || !inputValue.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-colors whitespace-nowrap"
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
          {urls.map((url, index) => {
            const title = getProductTitle(url);
            return (
              <div
                key={index}
                className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 border border-indigo-200"
              >
                <span className="max-w-[300px] truncate font-medium">
                  {title ? `${title}` : url}
                </span>
                {title && (
                  <span className="text-xs text-indigo-400 truncate max-w-[150px]">{url}</span>
                )}
                <button
                  onClick={() => removeUrl(index)}
                  className="ml-1 rounded-full p-0.5 hover:bg-indigo-200 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
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
