import { Suspense } from 'react';
import GraphDashboard from '@/components/GraphDashboard';

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-[#080c14]">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Loading O2C Graph Intelligence...</p>
        </div>
      </div>
    }>
      <GraphDashboard />
    </Suspense>
  );
}
