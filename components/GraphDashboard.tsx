'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import ChatPanel from './ChatPanel';
import TopBar from './TopBar';
import NodeDetailPanel from './NodeDetailPanel';
import StatsBar from './StatsBar';
import { GraphNode, ChatMessage } from '@/lib/types';

type NodePanelDisplayMode = 'expanded' | 'minimized' | 'hidden';
type ChatPanelDisplayMode = 'expanded' | 'minimized';
type GranularOverlayMode = 'shown' | 'minimized' | 'hidden';

// Dynamically import 3D graph to avoid SSR issues
const ForceGraph3D = dynamic(() => import('./ForceGraph3D'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#080c14]">
      <div className="text-center space-y-3">
        <div className="relative mx-auto w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping" />
          <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
        </div>
        <p className="text-slate-400 text-xs tracking-widest uppercase">Building Graph</p>
      </div>
    </div>
  ),
});

export default function GraphDashboard() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [nodePanelMode, setNodePanelMode] = useState<NodePanelDisplayMode>('hidden');
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [granularOverlayMode, setGranularOverlayMode] = useState<GranularOverlayMode>('shown');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    new Set(['SalesOrder', 'BillingDocument', 'Delivery', 'Payment', 'JournalEntry', 'Customer', 'Product'])
  );

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setNodePanelMode('expanded');
  }, []);

  const handleHighlight = useCallback((nodeIds: string[]) => {
    setHighlightedNodes(new Set(nodeIds));
    // Auto-clear after 10s
    setTimeout(() => setHighlightedNodes(new Set()), 10000);
  }, []);

  const handleNewMessage = useCallback((msg: ChatMessage) => {
    setChatHistory(prev => [...prev, msg]);
    if (msg.highlightedNodes?.length) {
      handleHighlight(msg.highlightedNodes);
    }
  }, [handleHighlight]);

  const isGranularOverlayHidden = granularOverlayMode === 'hidden';
  const isGranularOverlayMinimized = granularOverlayMode === 'minimized';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#080c14]">
      <TopBar />
      <StatsBar />

      <div className="flex flex-1 overflow-hidden relative">
        {/* 3D Force Graph */}
        <div className="flex-1 relative overflow-hidden">
          <ForceGraph3D
            onNodeClick={handleNodeClick}
            highlightedNodes={highlightedNodes}
            activeFilters={activeFilters}
            onFilterChange={setActiveFilters}
            granularOverlayMode={granularOverlayMode}
          />

          <div className="absolute top-12 left-4 z-30 flex items-center gap-2">
            <button
              onClick={() => {
                if (isGranularOverlayHidden) {
                  setGranularOverlayMode('shown');
                  return;
                }
                setGranularOverlayMode(v => (v === 'minimized' ? 'shown' : 'minimized'));
              }}
              className="glass-panel rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-blue-500/10 transition-colors"
              title={isGranularOverlayMinimized ? 'Expand granular overlay' : 'Minimize granular overlay'}
            >
              {isGranularOverlayMinimized || isGranularOverlayHidden ? 'Expand' : 'Minimize'}
            </button>
            <button
              onClick={() => {
                setGranularOverlayMode(v => (v === 'hidden' ? 'shown' : 'hidden'));
              }}
              className="glass-panel rounded-lg px-3 py-1.5 text-xs text-slate-200 hover:bg-blue-500/10 transition-colors"
              title={isGranularOverlayHidden ? 'Show granular overlay' : 'Hide granular overlay'}
            >
              {isGranularOverlayHidden ? 'Show Granular Overlay' : 'Hide Granular Overlay'}
            </button>
          </div>

          {/* Node Detail Panel */}
          {selectedNode && (
            <NodeDetailPanel
              node={selectedNode}
              mode={nodePanelMode}
              onToggleMinimize={() => setNodePanelMode(v => (v === 'minimized' ? 'expanded' : 'minimized'))}
            />
          )}

          {/* Highlight indicator */}
          {highlightedNodes.size > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 glass-panel rounded-full px-4 py-2 flex items-center gap-2 text-xs text-blue-300">
              <span className="pulse-dot w-2 h-2 rounded-full bg-blue-400 inline-block" />
              {highlightedNodes.size} node{highlightedNodes.size > 1 ? 's' : ''} highlighted from query
              <button
                onClick={() => setHighlightedNodes(new Set())}
                className="ml-2 text-slate-500 hover:text-slate-300"
              >✕</button>
            </div>
          )}
        </div>

        {/* Chat Panel */}
        <div className="flex-shrink-0 w-[400px]">
          <ChatPanel
            history={chatHistory}
            onNewMessage={handleNewMessage}
            onHighlight={handleHighlight}
          />
        </div>
      </div>
    </div>
  );
}
