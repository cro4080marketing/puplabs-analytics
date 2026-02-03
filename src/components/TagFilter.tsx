'use client';

import { useState, useEffect, useRef } from 'react';
import { TagFilter as TagFilterType, TagFilterLogic } from '@/types';

interface TagFilterProps {
  tagFilter: TagFilterType;
  onChange: (filter: TagFilterType) => void;
}

export default function TagFilter({ tagFilter, onChange }: TagFilterProps) {
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchTags = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shopify/tags');
      if (res.ok) {
        const data = await res.json();
        setAvailableTags(data.tags || []);
      }
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredSuggestions = availableTags.filter(
    (tag) =>
      tag.toLowerCase().includes(inputValue.toLowerCase()) &&
      !tagFilter.tags.includes(tag)
  );

  const addTag = (tag: string) => {
    if (!tagFilter.tags.includes(tag)) {
      onChange({ ...tagFilter, tags: [...tagFilter.tags, tag] });
    }
    setInputValue('');
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    onChange({
      ...tagFilter,
      tags: tagFilter.tags.filter((t) => t !== tag),
    });
  };

  const toggleLogic = () => {
    const newLogic: TagFilterLogic = tagFilter.logic === 'AND' ? 'OR' : 'AND';
    onChange({ ...tagFilter, logic: newLogic });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      addTag(inputValue.trim());
    }
  };

  return (
    <div ref={wrapperRef}>
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder={loading ? 'Loading tags...' : 'Filter by order tag...'}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />

          {/* Suggestions dropdown */}
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute left-0 top-full z-40 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {filteredSuggestions.map((tag) => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AND/OR toggle */}
        {tagFilter.tags.length > 1 && (
          <button
            onClick={toggleLogic}
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {tagFilter.logic}
          </button>
        )}
      </div>

      {/* Selected tags */}
      {tagFilter.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tagFilter.tags.map((tag) => (
            <div
              key={tag}
              className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700 border border-amber-200"
            >
              <span className="font-medium">{tag}</span>
              <button
                onClick={() => removeTag(tag)}
                className="rounded-full p-0.5 hover:bg-amber-200 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ tags: [], logic: 'OR' })}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
