'use client';

import { AttributionMethod } from '@/types';

interface AttributionSelectorProps {
  method: AttributionMethod;
  onChange: (method: AttributionMethod) => void;
}

const METHODS: { value: AttributionMethod; label: string; description: string }[] = [
  { value: 'landing_page', label: 'Landing Page', description: 'First page the customer visited' },
  { value: 'last_page', label: 'Last Page', description: 'Last page before checkout' },
  { value: 'referrer', label: 'Referrer', description: 'Referring site URL' },
  { value: 'utm', label: 'UTM Params', description: 'UTM parameter matching' },
];

export default function AttributionSelector({ method, onChange }: AttributionSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-500">Attribution:</label>
      <select
        value={method}
        onChange={(e) => onChange(e.target.value as AttributionMethod)}
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
