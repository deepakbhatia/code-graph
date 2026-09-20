import { weakestHonesty } from "./honesty.ts";
import {
  EdgeKind,
  FileRole,
  Honesty,
  NodeKind,
  nodeFile,
  type FileNode,
  type GraphEdge,
  type GraphNode,
  type NodeKind as NodeKindType,
  type SymbolKind,
} from "./ir.ts";
import type { GraphStore, StaleFile } from "./store.ts";

const RESOLUTION_KINDS: EdgeKind[] = [
  EdgeKind.Calls,
  EdgeKind.Imports,
  EdgeKind.Handles,
];

export interface QueryMeta {
  staleFiles: StaleFile[];
}

export interface LookupQuery {
  id?: string;
  name?: string;
  file?: string;
  kind?: NodeKindType;
  symbolKind?: SymbolKind;
}

export interface LookupResult extends QueryMeta {
  nodes: GraphNode[];
}

export interface Neighbor {
  node: GraphNode | null;
  edge: GraphEdge;
}

export interface ImpactQuery {
  id?: string;
  name?: string;
  file?: string;
  depth?: number;
}

export interface ImpactResult extends QueryMeta {
  matches: GraphNode[];
  symbol: GraphNode | null;
  callers: Neighbor[];
  callees: Neighbor[];
  testFiles: FileNode[];
}

export interface PathQuery {
  fromId: string;
  toId: string;
  maxDepth?: number;
  kinds?: EdgeKind[];
}

export interface PathHop {
  node: GraphNode;
  via: GraphEdge | null;
}

export interface PathResult extends QueryMeta {
  found: boolean;
  hops: PathHop[];
  strength: Honesty | null;
}

/**
 * Find Entry nodes by adapter-supplied fields. The kernel does not interpret
 * the key (it is not a filesystem or framework path).
 */
export interface RouteQuery {
  protocol?: string;
  qualifier?: string;
  key?: string;
}

export interface RouteHandler {
  entry: GraphNode;
  handler: GraphNode | null;
  handleEdge: GraphEdge | null;
  callees: Neighbor[];
}

export interface RouteResult extends QueryMeta {
  entries: GraphNode[];
  handlers: RouteHandler[];
}

export function lookup(store: GraphStore, query: LookupQuery): LookupResult {
  return {
    staleFiles: store.staleFiles(),
    nodes: store.listNodes(query),
  };
}

export function impact(store: GraphStore, query: ImpactQuery): ImpactResult {
  const matches = store.listNodes({
    id: query.id,
    name: query.name,
    file: query.file,
  });
  const staleFiles = store.staleFiles();
  if (matches.length !== 1) {
    return {
      staleFiles,
      matches,
      symbol: null,
      callers: [],
      callees: [],
      testFiles: [],
    };
  }
  const symbol = matches[0]!;
  const depth = query.depth ?? 1;
  const callers = walk(store, symbol.id, "in", [EdgeKind.Calls], depth);
  const callees = walk(store, symbol.id, "out", [EdgeKind.Calls], depth);
  return {
    staleFiles,
    matches,
    symbol,
    callers,
    callees,
    testFiles: testFilesImporting(store, [symbol, ...nodesOf(callers), ...nodesOf(callees)]),
  };
}

export function path(store: GraphStore, query: PathQuery): PathResult {
  const staleFiles = store.staleFiles();
  const start = store.getNode(query.fromId);
  const goal = store.getNode(query.toId);
  if (!start || !goal) {
    return { staleFiles, found: false, hops: start ? [{ node: start, via: null }] : [], strength: null };
  }
  if (start.id === goal.id) {
    return { staleFiles, found: true, hops: [{ node: start, via: null }], strength: Honesty.Extracted };
  }

  const kinds = query.kinds ?? RESOLUTION_KINDS;
  const maxDepth = query.maxDepth ?? 16;
  const visited = new Set<string>([start.id]);
  const parent = new Map<string, { id: string; edge: GraphEdge }>();
  const queue: Array<{ id: string; depth: number }> = [{ id: start.id, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) {
      continue;
    }
    for (const step of nextSteps(store, current.id, kinds)) {
      if (visited.has(step.id)) {
        continue;
      }
      visited.add(step.id);
      parent.set(step.id, { id: current.id, edge: step.edge });
      if (step.id === goal.id) {
        const hops = reconstruct(store, start, goal.id, parent);
        return {
          staleFiles,
          found: true,
          hops,
          strength: weakestHonesty(
            hops.map((hop) => hop.via?.honesty).filter((tag): tag is Honesty => tag !== undefined),
          ),
        };
      }
      queue.push({ id: step.id, depth: current.depth + 1 });
    }
  }

  return { staleFiles, found: false, hops: [{ node: start, via: null }], strength: null };
}

export function route(store: GraphStore, query: RouteQuery): RouteResult {
  const entries = store.listNodes({
    kind: NodeKind.Entry,
    protocol: query.protocol,
    qualifier: query.qualifier,
    entryKey: query.key,
  });
  const handlers: RouteHandler[] = entries.map((entry) => {
    const handleEdges = store
      .listEdges({ srcId: entry.id, kind: EdgeKind.Handles })
      .sort((a, b) => honestyRank(b.honesty) - honestyRank(a.honesty));
    const handleEdge = handleEdges[0] ?? null;
    const handler =
      handleEdge?.honesty === Honesty.Extracted && handleEdge.dstId
        ? (store.getNode(handleEdge.dstId) ?? null)
        : null;
    const callees = handler
      ? walk(store, handler.id, "out", [EdgeKind.Calls], 1)
      : [];
    return { entry, handler, handleEdge, callees };
  });
  return {
    staleFiles: store.staleFiles(),
    entries,
    handlers,
  };
}

function honestyRank(tag: Honesty): number {
  if (tag === Honesty.Extracted) return 2;
  if (tag === Honesty.Ambiguous) return 1;
  return 0;
}

function walk(
  store: GraphStore,
  startId: string,
  direction: "in" | "out",
  kinds: EdgeKind[],
  depth: number,
): Neighbor[] {
  const found: Neighbor[] = [];
  const seen = new Set<string>();
  const queue: Array<{ id: string; remaining: number }> = [
    { id: startId, remaining: depth },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.remaining <= 0) {
      continue;
    }
    const edges =
      direction === "out"
        ? store.listEdges({ srcId: current.id }).filter((edge) => kinds.includes(edge.kind))
        : collectIncoming(store, current.id, kinds);

    for (const edge of edges) {
      const neighborIds =
        direction === "out" ? destinations(edge) : [edge.srcId];
      if (neighborIds.length === 0 && direction === "out") {
        const key = `${edge.id}:unresolved`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ node: null, edge });
        }
        continue;
      }
      for (const id of neighborIds) {
        const key = `${edge.id}:${id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const node = store.getNode(id) ?? null;
        found.push({ node, edge });
        if (node && current.remaining > 1) {
          queue.push({ id: node.id, remaining: current.remaining - 1 });
        }
      }
    }
  }
  return found;
}

function collectIncoming(store: GraphStore, nodeId: string, kinds: EdgeKind[]): GraphEdge[] {
  const direct = store
    .listEdges({ dstId: nodeId })
    .filter((edge) => kinds.includes(edge.kind));
  const viaCandidates = store
    .listEdges({})
    .filter(
      (edge) =>
        kinds.includes(edge.kind) &&
        edge.honesty === Honesty.Ambiguous &&
        edge.candidates.includes(nodeId),
    );
  return [...direct, ...viaCandidates];
}

function destinations(edge: GraphEdge): string[] {
  if (edge.honesty === Honesty.Extracted && edge.dstId) {
    return [edge.dstId];
  }
  if (edge.honesty === Honesty.Ambiguous) {
    return edge.candidates;
  }
  return [];
}

function nextSteps(
  store: GraphStore,
  nodeId: string,
  kinds: EdgeKind[],
): Array<{ id: string; edge: GraphEdge }> {
  const steps: Array<{ id: string; edge: GraphEdge }> = [];
  for (const edge of store.listEdges({ srcId: nodeId })) {
    if (!kinds.includes(edge.kind)) {
      continue;
    }
    for (const id of destinations(edge)) {
      steps.push({ id, edge });
    }
  }
  return steps;
}

function reconstruct(
  store: GraphStore,
  start: GraphNode,
  goalId: string,
  parent: Map<string, { id: string; edge: GraphEdge }>,
): PathHop[] {
  const hops: PathHop[] = [];
  let cursor: string | undefined = goalId;
  while (cursor && cursor !== start.id) {
    const step = parent.get(cursor);
    const node = store.getNode(cursor);
    if (!step || !node) {
      break;
    }
    hops.unshift({ node, via: step.edge });
    cursor = step.id;
  }
  hops.unshift({ node: start, via: null });
  return hops;
}

function nodesOf(neighbors: Neighbor[]): GraphNode[] {
  return neighbors
    .map((neighbor) => neighbor.node)
    .filter((node): node is GraphNode => node !== null);
}

function testFilesImporting(store: GraphStore, radius: GraphNode[]): FileNode[] {
  const radiusFiles = new Set(radius.map(nodeFile));
  const tests: FileNode[] = [];
  const seen = new Set<string>();
  for (const node of store.listNodes({ kind: NodeKind.File })) {
    if (node.kind !== NodeKind.File || node.role !== FileRole.Test) {
      continue;
    }
    const imports = store
      .listEdges({ srcId: node.id, kind: EdgeKind.Imports })
      .filter((edge) => edge.honesty === Honesty.Extracted && edge.dstId);
    for (const edge of imports) {
      const dest = edge.dstId ? store.getNode(edge.dstId) : undefined;
      if (!dest) {
        continue;
      }
      if (radiusFiles.has(nodeFile(dest)) && !seen.has(node.path)) {
        seen.add(node.path);
        tests.push(node);
      }
    }
  }
  return tests;
}
