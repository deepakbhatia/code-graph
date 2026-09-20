export type { GraphAdapter, SourceFile } from "./adapter.ts";
export {
  HonestyError,
  assertHonestEdge,
  classifyResolution,
  isStructuralEdge,
  weakestHonesty,
} from "./honesty.ts";
export {
  EdgeKind,
  FileRole,
  Honesty,
  NodeKind,
  ProofKind,
  SymbolKind,
  edgeId,
  entryNode,
  entryNodeId,
  fileNode,
  fileNodeId,
  graphEdge,
  nodeFile,
  structuralContains,
  symbolNode,
  symbolNodeId,
  zeroSpan,
} from "./ir.ts";
export type {
  BindingProof,
  EntryNode,
  FileNode,
  GraphBatch,
  GraphEdge,
  GraphNode,
  Span,
  SymbolNode,
} from "./ir.ts";
export {
  impact,
  lookup,
  path,
  route,
} from "./queries.ts";
export type {
  ImpactQuery,
  ImpactResult,
  LookupQuery,
  LookupResult,
  Neighbor,
  PathHop,
  PathQuery,
  PathResult,
  QueryMeta,
  RouteHandler,
  RouteQuery,
  RouteResult,
} from "./queries.ts";
export { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";
export { GraphStore } from "./store.ts";
export type { StaleFile } from "./store.ts";
