'use client';

import { useEffect, useState } from 'react';
import { GraphNode, NODE_COLORS } from '@/lib/types';

interface Props {
  readonly node: GraphNode;
  readonly mode: 'expanded' | 'minimized' | 'hidden';
  readonly onToggleMinimize: () => void;
}

const FRIENDLY_LABELS: Record<string, string> = {
  salesOrder: 'Sales Order',
  soldToParty: 'Customer ID',
  totalNetAmount: 'Net Amount',
  transactionCurrency: 'Currency',
  overallDeliveryStatus: 'Delivery Status',
  overallOrdReltdBillgStatus: 'Billing Status',
  creationDate: 'Created',
  requestedDeliveryDate: 'Requested Delivery',
  billingDocument: 'Billing Doc #',
  billingDocumentDate: 'Billing Date',
  billingDocumentIsCancelled: 'Cancelled',
  accountingDocument: 'Accounting Doc',
  deliveryDocument: 'Delivery Doc #',
  actualGoodsMovementDate: 'Goods Movement',
  overallGoodsMovementStatus: 'GR Status',
  businessPartnerFullName: 'Full Name',
  businessPartnerName: 'Name',
  industry: 'Industry',
  product: 'Product ID',
  productDescription: 'Description',
  productGroup: 'Group',
  grossWeight: 'Gross Weight',
  amountInTransactionCurrency: 'Amount',
  clearingDate: 'Cleared On',
  postingDate: 'Posted',
};

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  A: { label: 'Not Started', color: '#94a3b8' },
  B: { label: 'Partial', color: '#f59e0b' },
  C: { label: 'Complete', color: '#10b981' },
  true: { label: 'Yes', color: '#ef4444' },
  false: { label: 'No', color: '#10b981' },
};

function formatValue(key: string, val: string | null): React.ReactNode {
  if (!val || val === 'null' || val === '') return <span className="text-slate-600">—</span>;

  if (key.toLowerCase().includes('date') && val.includes('T')) {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? val : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  const parsedAmount = Number.parseFloat(val);
  if (key.toLowerCase().includes('amount') && !Number.isNaN(parsedAmount)) {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(parsedAmount);
  }

  const badge = STATUS_BADGES[val];
  if (badge && (key.toLowerCase().includes('status') || key.toLowerCase().includes('cancelled') || key.toLowerCase().includes('blocked'))) {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: badge.color + '20', color: badge.color }}>
        {badge.label}
      </span>
    );
  }

  return val;
}

const SKIP_KEYS = new Set(['__typename', 'nodeType', 'id', 'label']);
const PRIORITY_KEYS = ['salesOrder', 'billingDocument', 'deliveryDocument', 'accountingDocument', 'businessPartner', 'product', 'productDescription', 'businessPartnerFullName', 'totalNetAmount', 'transactionCurrency', 'soldToParty', 'creationDate', 'overallDeliveryStatus', 'overallOrdReltdBillgStatus'];

export default function NodeDetailPanel({ node, mode, onToggleMinimize }: Props) {
  const [details, setDetails] = useState<GraphNode>(node);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDetails(node);
    setLoading(true);
    fetch(`/api/node/${encodeURIComponent(node.id)}`)
      .then(r => r.json())
      .then(d => { setDetails(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [node.id]);

  const color = NODE_COLORS[node.nodeType] ?? '#64748b';
  const allEntries = Object.entries(details.data ?? {}).filter(([k]) => !SKIP_KEYS.has(k));
  const priorityEntries = PRIORITY_KEYS.map(k => [k, details.data?.[k]] as [string, string | null]).filter(([, v]) => v != null && v !== '');
  const otherEntries = allEntries.filter(([k]) => !PRIORITY_KEYS.includes(k) && details.data?.[k]);

  if (mode === 'hidden') return null;

  return (
    <div className={`node-detail-panel absolute top-4 left-4 w-72 glass-panel-bright rounded-xl overflow-hidden shadow-2xl z-20 ${mode === 'expanded' ? 'max-h-[calc(100vh-6rem)]' : ''}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-start justify-between"
        style={{ background: `linear-gradient(135deg, ${color}15, transparent)` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + '20', border: `1px solid ${color}40` }}>
            <span className="w-3 h-3 rounded-full" style={{ background: color }} />
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color }}>
              {node.nodeType}
            </div>
            <div className="text-xs font-semibold text-white font-mono mt-0.5 truncate max-w-[160px]">
              {loading ? <span className="animate-pulse">Loading...</span> : details.label}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleMinimize}
            className="text-slate-500 hover:text-slate-300 transition-colors p-0.5 -mt-0.5"
            title={mode === 'minimized' ? 'Expand panel' : 'Minimize panel'}
          >
            {mode === 'minimized' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Data rows */}
      {mode === 'expanded' && (
      <div className="overflow-y-auto max-h-[380px] divide-y divide-white/[0.04]">
        {loading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="flex justify-between animate-pulse">
                <div className="h-3 w-24 bg-white/5 rounded" />
                <div className="h-3 w-20 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {priorityEntries.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between px-4 py-2 gap-2 hover:bg-white/[0.02] transition-colors">
                <span className="text-[10px] text-slate-500 shrink-0 mt-0.5 max-w-[100px]">
                  {FRIENDLY_LABELS[k] ?? k}
                </span>
                <span className="text-[11px] text-slate-200 text-right font-mono break-all">
                  {formatValue(k, v)}
                </span>
              </div>
            ))}
            {otherEntries.length > 0 && (
              <>
                <div className="px-4 py-1.5 bg-white/[0.02]">
                  <span className="text-[9px] text-slate-600 uppercase tracking-widest">Additional Fields</span>
                </div>
                {otherEntries.slice(0, 10).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between px-4 py-1.5 gap-2 hover:bg-white/[0.02] transition-colors">
                    <span className="text-[10px] text-slate-600 shrink-0 mt-0.5 max-w-[100px]">
                      {FRIENDLY_LABELS[k] ?? k}
                    </span>
                    <span className="text-[10px] text-slate-400 text-right font-mono break-all">
                      {formatValue(k, v)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
      )}

      {/* Footer */}
      {mode === 'expanded' && (
      <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-slate-600 font-mono">{node.id}</span>
        <span className="text-[10px] text-slate-600">{allEntries.length} fields</span>
      </div>
      )}
    </div>
  );
}
