'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GraphData, GraphNode, GraphEdge, NODE_COLORS, NODE_SIZES } from '@/lib/types';
import { detectClusters, getClusterColor, analyzeGraphStructure } from '@/lib/graph-clustering';

interface Props {
  onNodeClick: (node: GraphNode) => void;
  highlightedNodes: Set<string>;
  activeFilters: Set<string>;
  onFilterChange: (filters: Set<string>) => void;
  granularOverlayMode: 'shown' | 'minimized' | 'hidden';
}

const ALL_TYPES = ['SalesOrder', 'BillingDocument', 'Delivery', 'Payment', 'JournalEntry', 'Customer', 'Product'];

export default function ForceGraph3D({ onNodeClick, highlightedNodes, activeFilters, onFilterChange, granularOverlayMode }: Readonly<Props>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const threeRef = useRef<any>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);
  const [clusters, setClusters] = useState<Map<string, number>>(new Map());
  const [graphAnalysis, setGraphAnalysis] = useState<any>(null);

  const getNodeId = (nodeOrId: string | GraphNode) =>
    typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => r.json())
      .then((data: GraphData) => {
        setGraphData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Graph fetch error:', err);
        setLoading(false);
      });
  }, []);

  const filteredData = useMemo(() => {
    if (!graphData) return null;

    const visibleNodeIds = new Set(
      graphData.nodes.filter((node) => activeFilters.has(node.nodeType)).map((node) => node.id)
    );

    return {
      nodes: graphData.nodes.filter((node) => visibleNodeIds.has(node.id)),
      links: graphData.links.filter((link) => {
        const sourceId = getNodeId(link.source);
        const targetId = getNodeId(link.target);
        return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
      }),
    };
  }, [graphData, activeFilters]);

  // Compute graph clustering and analysis
  useMemo(() => {
    if (!filteredData) {
      setClusters(new Map());
      setGraphAnalysis(null);
      return;
    }

    const clusterMap = detectClusters(filteredData.nodes, filteredData.links);
    const analysis = analyzeGraphStructure(filteredData.nodes, filteredData.links);

    // Convert ClusterInfo to cluster ID map
    const clusterIdMap = new Map<string, number>();
    for (const [nodeId, clusterInfo] of clusterMap) {
      clusterIdMap.set(nodeId, clusterInfo.clusterId);
    }

    setClusters(clusterIdMap);
    setGraphAnalysis(analysis);
  }, [filteredData]);

  const highlightContext = useMemo(() => {
    if (!filteredData || highlightedNodes.size === 0) {
      return {
        highlightedNodeIds: new Set<string>(),
        connectedNodeIds: new Set<string>(),
        highlightedEdgeKeys: new Set<string>(),
        adjacentEdgeKeys: new Set<string>(),
      };
    }

    const highlightedNodeIds = new Set(highlightedNodes);
    const connectedNodeIds = new Set<string>(highlightedNodeIds);
    const highlightedEdgeKeys = new Set<string>();
    const adjacentEdgeKeys = new Set<string>();

    for (const link of filteredData.links) {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      const edgeKey = `${sourceId}->${targetId}`;
      const sourceHighlighted = highlightedNodeIds.has(sourceId);
      const targetHighlighted = highlightedNodeIds.has(targetId);

      if (sourceHighlighted && targetHighlighted) {
        highlightedEdgeKeys.add(edgeKey);
        connectedNodeIds.add(sourceId);
        connectedNodeIds.add(targetId);
      } else if (sourceHighlighted || targetHighlighted) {
        adjacentEdgeKeys.add(edgeKey);
        connectedNodeIds.add(sourceId);
        connectedNodeIds.add(targetId);
      }
    }

    return { highlightedNodeIds, connectedNodeIds, highlightedEdgeKeys, adjacentEdgeKeys };
  }, [filteredData, highlightedNodes]);

  const createNodeObject = useCallback((node: GraphNode) => {
    const THREE = threeRef.current;
    if (!THREE) return null;

    // Use cluster color if available, otherwise use node type color
    let color = NODE_COLORS[node.nodeType] ?? '#64748b';
    if (clusters.has(node.id)) {
      const clusterId = clusters.get(node.id)!;
      color = getClusterColor(clusterId);
    }

    const baseSize = NODE_SIZES[node.nodeType] ?? 5;
    const isHighlighted = highlightContext.highlightedNodeIds.has(node.id);
    const isConnected = highlightContext.connectedNodeIds.has(node.id);
    const isDimmed = highlightedNodes.size > 0 && !isConnected;
    const radius = isHighlighted ? baseSize * 1.75 : isConnected ? baseSize * 1.15 : baseSize;

    const geometry = new THREE.SphereGeometry(radius, 18, 18);
    const material = new THREE.MeshPhongMaterial({
      color: isDimmed ? 0x22324e : Number.parseInt(color.slice(1), 16),
      emissive: isHighlighted ? Number.parseInt(color.slice(1), 16) : 0x000000,
      emissiveIntensity: isHighlighted ? 0.35 : 0,
      shininess: isHighlighted ? 70 : 35,
      transparent: true,
      opacity: isDimmed ? 0.16 : isHighlighted ? 1 : isConnected ? 0.95 : 0.88,
    });
    const mesh = new THREE.Mesh(geometry, material);

    if (isHighlighted) {
      const ringGeo = new THREE.TorusGeometry(radius * 1.55, Math.max(0.7, radius * 0.12), 10, 40);
      const ringMat = new THREE.MeshBasicMaterial({
        color: Number.parseInt(color.slice(1), 16),
        transparent: true,
        opacity: 0.75,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 3;
      mesh.add(ring);
    }

    return mesh;
  }, [highlightContext, highlightedNodes, clusters]);

  const applyLinkStyling = useCallback((fg: any) => {
    fg
      .linkColor((link: GraphEdge) => {
        if (granularOverlayMode === 'hidden') return 'rgba(0,0,0,0)';
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;

        if (highlightContext.highlightedEdgeKeys.has(edgeKey)) return '#60a5fa';
        if (highlightContext.adjacentEdgeKeys.has(edgeKey)) return '#3b82f6';
        return highlightedNodes.size > 0 ? '#253854' : '#355176';
      })
      .linkOpacity((link: GraphEdge) => {
        if (granularOverlayMode === 'hidden') return 0;
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;
        let baseOpacity = 0.38;
        if (highlightContext.highlightedEdgeKeys.has(edgeKey)) {
          baseOpacity = 0.98;
        } else if (highlightContext.adjacentEdgeKeys.has(edgeKey)) {
          baseOpacity = 0.56;
        } else if (highlightedNodes.size > 0) {
          baseOpacity = 0.12;
        }
        if (granularOverlayMode === 'minimized') {
          return baseOpacity * 0.35;
        }
        return baseOpacity;
      })
      .linkWidth((link: GraphEdge) => {
        if (granularOverlayMode === 'hidden') return 0;
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;
        let baseWidth = 1.2;
        if (highlightContext.highlightedEdgeKeys.has(edgeKey)) {
          baseWidth = 3.4;
        } else if (highlightContext.adjacentEdgeKeys.has(edgeKey)) {
          baseWidth = 1.8;
        } else if (highlightedNodes.size > 0) {
          baseWidth = 0.45;
        }
        if (granularOverlayMode === 'minimized') {
          return baseWidth * 0.5;
        }
        return baseWidth;
      })
      .linkDirectionalArrowLength((link: GraphEdge) => {
        if (granularOverlayMode !== 'shown') return 0;
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;
        if (highlightContext.highlightedEdgeKeys.has(edgeKey)) return 5.2;
        if (highlightContext.adjacentEdgeKeys.has(edgeKey)) return 3.8;
        return highlightedNodes.size > 0 ? 1.5 : 2.6;
      })
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((link: GraphEdge) => {
        if (granularOverlayMode === 'hidden') return 'rgba(0,0,0,0)';
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;
        if (highlightContext.highlightedEdgeKeys.has(edgeKey)) return '#93c5fd';
        if (highlightContext.adjacentEdgeKeys.has(edgeKey)) return '#60a5fa';
        return highlightedNodes.size > 0 ? '#273b57' : '#4b6f97';
      })
      .linkDirectionalParticles((link: GraphEdge) => {
        if (granularOverlayMode !== 'shown') return 0;
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;
        if (highlightContext.highlightedEdgeKeys.has(edgeKey)) return 8;
        if (highlightContext.adjacentEdgeKeys.has(edgeKey)) return 3;
        return 0;
      })
      .linkDirectionalParticleSpeed(() => 0.0048)
      .linkDirectionalParticleWidth((link: GraphEdge) => {
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;
        return highlightContext.highlightedEdgeKeys.has(edgeKey) ? 2.8 : 1.6;
      })
      .linkDirectionalParticleColor((link: GraphEdge) => {
        const srcId = getNodeId(link.source);
        const tgtId = getNodeId(link.target);
        const edgeKey = `${srcId}->${tgtId}`;
        return highlightContext.highlightedEdgeKeys.has(edgeKey) ? '#dbeafe' : '#60a5fa';
      });
  }, [highlightContext, highlightedNodes, granularOverlayMode]);

  useEffect(() => {
    if (!containerRef.current || !filteredData || initialized) return;

    const initGraph = async () => {
      try {
        const graphModule = await import('3d-force-graph');
        const Graph = graphModule.default as any;
        const THREE = await import('three');
        threeRef.current = THREE;

        const width = containerRef.current!.clientWidth;
        const height = containerRef.current!.clientHeight;

        const fg = Graph()(containerRef.current!)
          .width(width)
          .height(height)
          .backgroundColor('#080c14')
          .nodeLabel('')
          .nodeThreeObject(createNodeObject)
          .nodeThreeObjectExtend(false)
          .onNodeClick((node: GraphNode) => {
            onNodeClick(node);
            const distance = 80;
            const distRatio = 1 + distance / Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0);
            fg.cameraPosition(
              { x: (node.x ?? 0) * distRatio, y: (node.y ?? 0) * distRatio, z: (node.z ?? 0) * distRatio },
              node,
              800
            );
          })
          .onNodeHover((node: GraphNode | null) => {
            setHoveredNode(node);
            if (containerRef.current) {
              containerRef.current.style.cursor = node ? 'pointer' : 'grab';
            }
          })
          .graphData(filteredData);

        applyLinkStyling(fg);

        fg.cameraPosition({ x: 0, y: 0, z: 600 });
        fg.d3AlphaDecay(0.018);
        fg.d3VelocityDecay(0.2);

        const scene = fg.scene();
        scene.add(new THREE.AmbientLight(0x4b5f82, 1.65));
        const dirLight = new THREE.DirectionalLight(0x70a5ff, 1.25);
        dirLight.position.set(120, 140, 110);
        scene.add(dirLight);
        const fillLight = new THREE.DirectionalLight(0x8b5cf6, 0.55);
        fillLight.position.set(-140, -80, -60);
        scene.add(fillLight);

        graphRef.current = fg;
        setInitialized(true);
      } catch {
        console.error('Failed to load 3d-force-graph');
      }
    };

    initGraph();
  }, [filteredData, initialized, createNodeObject, applyLinkStyling, onNodeClick]);

  useEffect(() => {
    if (!graphRef.current) return;
    const fg = graphRef.current;
    applyLinkStyling(fg);
    fg.refresh();
  }, [applyLinkStyling]);

  useEffect(() => {
    if (!graphRef.current || !filteredData) return;
    const fg = graphRef.current;
    fg.nodeThreeObject(createNodeObject);
    fg.graphData(filteredData);
    fg.refresh();
  }, [filteredData, createNodeObject]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX + 16, y: e.clientY - 8 });
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (graphRef.current && containerRef.current) {
        graphRef.current.width(containerRef.current.clientWidth);
        graphRef.current.height(containerRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleFilter = (type: string) => {
    const next = new Set(activeFilters);
    if (next.has(type)) {
      if (next.size > 1) next.delete(type);
    } else {
      next.add(type);
    }
    onFilterChange(next);
  };

  return (
    <div className="relative w-full h-full" onMouseMove={handleMouseMove}>
      <div ref={containerRef} className="w-full h-full graph-canvas" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#080c14]">
          <div className="text-center space-y-4">
            <div className="relative mx-auto w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping" />
              <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <div className="absolute inset-2 rounded-full border border-violet-500/40 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
            <div className="space-y-1">
              <p className="text-slate-300 text-sm font-medium">Building Knowledge Graph</p>
              <p className="text-slate-600 text-xs">Processing SAP O2C entities...</p>
            </div>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5 max-w-xs">
        {ALL_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => toggleFilter(type)}
            className={`legend-pill ${activeFilters.has(type) ? 'active' : 'opacity-40'}`}
            style={{ color: NODE_COLORS[type as keyof typeof NODE_COLORS] }}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: NODE_COLORS[type as keyof typeof NODE_COLORS] }}
            />
            {type}
          </button>
        ))}
      </div>

      {filteredData && (
        <div className="absolute top-24 left-4 space-y-1.5 z-20">
          <div className="glass-panel rounded-lg px-3 py-1.5 text-xs text-slate-400">
            <span className="text-blue-400 font-medium">{filteredData.nodes.length}</span> nodes ·{' '}
            <span className="text-blue-400 font-medium">{filteredData.links.length}</span> edges
          </div>
          {graphAnalysis && (
            <div className="glass-panel rounded-lg px-3 py-1.5 text-xs text-slate-400 space-y-1">
              <div>
                <span className="text-emerald-400 font-medium">{graphAnalysis.clusterCount}</span> clusters
              </div>
              <div className="text-slate-500">
                Avg connectivity:{' '}
                <span className="text-blue-400 font-medium">{graphAnalysis.avgConnectivity.toFixed(1)}</span>
              </div>
              {graphAnalysis.isolatedNodeCount > 0 && (
                <div className="text-slate-500">
                  Isolated nodes:{' '}
                  <span className="text-amber-400 font-medium">{graphAnalysis.isolatedNodeCount}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {hoveredNode && (
        <div className="graph-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: NODE_COLORS[hoveredNode.nodeType] }}
            />
            <span className="font-semibold text-white text-xs">{hoveredNode.nodeType}</span>
          </div>
          <div className="text-slate-300 font-mono text-[11px]">{hoveredNode.label}</div>
          {Object.entries(hoveredNode.data ?? {})
            .filter(([k, v]) => v && !['__typename'].includes(k))
            .slice(0, 4)
            .map(([k, v]) => (
              <div key={k} className="flex gap-2 mt-1 text-[10px]">
                <span className="text-slate-500 truncate max-w-[80px]">{k}</span>
                <span className="text-slate-300 truncate max-w-[130px]">{v}</span>
              </div>
            ))}
          <div className="mt-2 text-[10px] text-slate-600">Click to inspect →</div>
        </div>
      )}

      <div className="absolute top-4 right-4 glass-panel rounded-lg px-3 py-2 text-[10px] text-slate-600 space-y-0.5">
        <div>🖱 Drag to rotate</div>
        <div>⚙ Scroll to zoom</div>
        <div>👆 Click node to inspect</div>
      </div>
    </div>
  );
}
