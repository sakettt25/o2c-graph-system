'use client';

export default function TopBar() {
  return (
    <header className="flex-shrink-0 h-12 glass-panel border-b flex items-center px-5 justify-between z-30">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="2" strokeWidth={2}/>
            <circle cx="5" cy="19" r="2" strokeWidth={2}/>
            <circle cx="19" cy="19" r="2" strokeWidth={2}/>
            <path d="M12 7v3M5 17l5-4M19 17l-5-4" strokeWidth={2} strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <span className="text-sm font-semibold text-white tracking-tight">O2C Graph Intelligence</span>
          <span className="mx-2 text-slate-600">/</span>
          <span className="text-sm text-slate-400">Order to Cash</span>
        </div>
        <span className="ml-2 px-2 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full">
          LIVE
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
          Graph Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 pulse-dot" />
          AI Connected
        </span>
        <span className="text-slate-600">SAP ECC Dataset</span>
      </div>
    </header>
  );
}
