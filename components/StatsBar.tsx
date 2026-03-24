'use client';

import { useEffect, useState } from 'react';

interface Stats {
  salesOrders: number;
  billingDocuments: number;
  deliveries: number;
  payments: number;
  customers: number;
  products: number;
  totalRevenue: number;
  currency: string;
}

export default function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/summary')
      .then(r => r.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  const items = stats
    ? [
        { label: 'Sales Orders', value: stats.salesOrders, color: '#3b82f6' },
        { label: 'Billing Docs', value: stats.billingDocuments, color: '#10b981' },
        { label: 'Deliveries', value: stats.deliveries, color: '#f59e0b' },
        { label: 'Payments', value: stats.payments, color: '#8b5cf6' },
        { label: 'Customers', value: stats.customers, color: '#14b8a6' },
        { label: 'Products', value: stats.products, color: '#f97316' },
        {
          label: 'Total Revenue',
          value: `${stats.currency} ${(stats.totalRevenue / 1000).toFixed(1)}K`,
          color: '#22c55e',
        },
      ]
    : [];

  return (
    <div className="flex-shrink-0 h-9 bg-[#0a0e1a] border-b border-blue-500/10 flex items-center px-5 gap-6 overflow-x-auto">
      {!stats ? (
        <span className="text-xs text-slate-600 animate-pulse">Loading stats...</span>
      ) : (
        items.map(item => (
          <div key={item.label} className="flex items-center gap-2 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
            <span className="text-[11px] text-slate-500">{item.label}</span>
            <span className="text-[11px] font-semibold" style={{ color: item.color }}>
              {item.value}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
