/**
 * Graph clustering and community detection algorithms
 * Identifies clusters of related nodes in the graph
 */

type NodeType = 'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product';

export interface ClusterInfo {
  nodeId: string;
  clusterId: number;
  confidence: number;
}

export interface Cluster {
  id: number;
  nodeIds: string[];
  size: number;
  density: number;
  color: string;
}

/**
 * Extract node ID from edge endpoint (handles both string and object formats)
 */
function getEdgeNodeId(endpoint: string | Record<string, unknown>): string {
  if (typeof endpoint === 'string') {
    return endpoint;
  }
  const id = endpoint.id;
  if (typeof id === 'string') {
    return id;
  }
  if (typeof id === 'number') {
    return String(id);
  }
  return JSON.stringify(endpoint);
}

/**
 * Build adjacency list from nodes and edges
 */
function buildAdjacencyList(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string | Record<string, unknown>; target: string | Record<string, unknown> }>
): Map<string, Set<string>> {
  const adjList = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjList.set(node.id, new Set());
  }

  for (const edge of edges) {
    const source = getEdgeNodeId(edge.source);
    const target = getEdgeNodeId(edge.target);

    if (adjList.has(source) && adjList.has(target)) {
      const sourceSet = adjList.get(source);
      const targetSet = adjList.get(target);
      if (sourceSet && targetSet) {
        sourceSet.add(target);
        targetSet.add(source);
      }
    }
  }

  return adjList;
}

/**
 * Run BFS to find connected component starting from a node
 */
function findConnectedComponent(
  startNode: string,
  adjList: Map<string, Set<string>>,
  visited: Set<string>
): Set<string> {
  const cluster = new Set<string>();
  const queue = [startNode];
  const maxClusterSize = 100;

  while (queue.length > 0 && cluster.size < maxClusterSize) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;

    visited.add(current);
    cluster.add(current);

    const neighbors = adjList.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  return cluster;
}

/**
 * Simple greedy clustering algorithm for community detection
 * Uses modularity-based approach to identify clusters
 */
export function detectClusters(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string | Record<string, unknown>; target: string | Record<string, unknown> }>
): Map<string, ClusterInfo> {
  const clusterMap = new Map<string, ClusterInfo>();
  const adjList = buildAdjacencyList(nodes, edges);

  // Greedy clustering: assign nodes to clusters based on neighbor connections
  let clusterId = 0;
  const visited = new Set<string>();

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    // Find connected component
    const cluster = findConnectedComponent(node.id, adjList, visited);

    // Assign cluster
    for (const nodeId of cluster) {
      const neighbors = adjList.get(nodeId);
      const degree = neighbors?.size || 0;
      const expectedDegree = Math.max(1, nodes.length / 10);
      clusterMap.set(nodeId, {
        nodeId,
        clusterId,
        confidence: Math.min(1, degree / expectedDegree),
      });
    }

    clusterId++;
  }

  // Handle isolated nodes
  for (const node of nodes) {
    if (!clusterMap.has(node.id)) {
      clusterMap.set(node.id, {
        nodeId: node.id,
        clusterId: clusterId++,
        confidence: 0,
      });
    }
  }

  return clusterMap;
}

/**
 * Calculate graph centrality metrics for each node
 * Useful for identifying important/central nodes in the graph
 */
export function calculateCentrality(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string | Record<string, unknown>; target: string | Record<string, unknown> }>
): Map<string, number> {
  const centrality = new Map<string, number>();
  const degrees = new Map<string, number>();

  // Initialize
  for (const node of nodes) {
    degrees.set(node.id, 0);
  }

  // Count degree (simple degree centrality)
  for (const edge of edges) {
    const source = getEdgeNodeId(edge.source);
    const target = getEdgeNodeId(edge.target);

    if (degrees.has(source)) {
      degrees.set(source, (degrees.get(source) || 0) + 1);
    }
    if (degrees.has(target)) {
      degrees.set(target, (degrees.get(target) || 0) + 1);
    }
  }

  // Normalize by max degree
  const maxDegree = Math.max(...Array.from(degrees.values()), 1);
  for (const [nodeId, degree] of degrees) {
    centrality.set(nodeId, degree / maxDegree);
  }

  return centrality;
}

/**
 * Generate colors for clusters (distinct colors for up to 12 clusters)
 */
const CLUSTER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#AED6F1',
  '#F5B7B1', '#D7BDE2',
];

export function getClusterColor(clusterId: number): string {
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
}

/**
 * Analyze graph structure and return insights
 */
export function analyzeGraphStructure(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string | Record<string, unknown>; target: string | Record<string, unknown> }>
): {
  nodeCount: number;
  clusterCount: number;
  avgClusterSize: number;
  avgConnectivity: number;
  isolatedNodeCount: number;
} {
  const clusters = detectClusters(nodes, edges);
  const clusterIds = new Set(Array.from(clusters.values()).map(c => c.clusterId));

  // Count degree for each node
  const degrees = new Map<string, number>();
  for (const node of nodes) {
    degrees.set(node.id, 0);
  }

  for (const edge of edges) {
    const source = getEdgeNodeId(edge.source);
    const target = getEdgeNodeId(edge.target);

    if (degrees.has(source)) {
      degrees.set(source, (degrees.get(source) || 0) + 1);
    }
    if (degrees.has(target)) {
      degrees.set(target, (degrees.get(target) || 0) + 1);
    }
  }

  const totalConnections = Array.from(degrees.values()).reduce((a, b) => a + b, 0);
  const avgConnectivity = nodes.length > 0 ? totalConnections / nodes.length : 0;
  const isolatedNodeCount = Array.from(degrees.values()).filter(d => d === 0).length;

  return {
    nodeCount: nodes.length,
    clusterCount: clusterIds.size,
    avgClusterSize: clusterIds.size > 0 ? nodes.length / clusterIds.size : 0,
    avgConnectivity,
    isolatedNodeCount,
  };
}
