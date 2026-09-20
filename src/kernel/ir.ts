/** Language-agnostic graph IR. Adapters emit this; the kernel never parses source. */

export const NodeKind = {
  File: "file",
  Symbol: "symbol",
  Entry: "entry",
} as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const SymbolKind = {
  File: "file",
  Function: "function",
  Method: "method",
  Class: "class",
  Variable: "variable",
  Type: "type",
  Unknown: "unknown",
} as const;
export type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind];

export const FileRole = {
  Source: "source",
  Test: "test",
  Generated: "generated",
  Unknown: "unknown",
} as const;
export type FileRole = (typeof FileRole)[keyof typeof FileRole];

export const EdgeKind = {
  Contains: "contains",
  Imports: "imports",
  Calls: "calls",
  Handles: "handles",
} as const;
export type EdgeKind = (typeof EdgeKind)[keyof typeof EdgeKind];

export const Honesty = {
  Extracted: "EXTRACTED",
  Unresolved: "UNRESOLVED",
  Ambiguous: "AMBIGUOUS",
} as const;
export type Honesty = (typeof Honesty)[keyof typeof Honesty];

export const ProofKind = {
  Import: "import",
  Local: "local",
  Export: "export",
  SameFile: "same_file",
  EntryBinding: "entry_binding",
} as const;
export type ProofKind = (typeof ProofKind)[keyof typeof ProofKind];

export interface Span {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/** Evidence that a name is bound — required for EXTRACTED. */
export interface BindingProof {
  kind: ProofKind;
  span: Span;
  /** Adapter-owned note (specifier, local name, program id, …). Not a resolution. */
  evidence: string;
}

export interface FileNode {
  id: string;
  kind: typeof NodeKind.File;
  path: string;
  contentHash: string;
  language?: string;
  role: FileRole;
}

export interface SymbolNode {
  id: string;
  kind: typeof NodeKind.Symbol;
  file: string;
  name: string;
  symbolKind: SymbolKind;
  span: Span;
}

/**
 * Framework-agnostic entry. Adapters fill protocol / qualifier / key.
 * The kernel only matches those fields — it does not interpret paths or filenames.
 */
export interface EntryNode {
  id: string;
  kind: typeof NodeKind.Entry;
  file: string;
  name: string;
  span?: Span;
  protocol: string;
  qualifier?: string;
  key: string;
}

export type GraphNode = FileNode | SymbolNode | EntryNode;

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  srcId: string;
  dstId: string | null;
  honesty: Honesty;
  proof: BindingProof | null;
  candidates: string[];
  unresolvedName?: string;
}

export interface GraphBatch {
  files: FileNode[];
  nodes: Array<SymbolNode | EntryNode>;
  edges: GraphEdge[];
}

export function fileNodeId(path: string): string {
  return `file:${path}`;
}

export function symbolNodeId(
  file: string,
  name: string,
  symbolKind: SymbolKind,
  span: Span,
): string {
  return `symbol:${file}:${name}:${symbolKind}:${span.startLine}:${span.startCol}`;
}

export function entryNodeId(
  file: string,
  protocol: string,
  qualifier: string | undefined,
  key: string,
): string {
  return `entry:${file}:${protocol}:${qualifier ?? ""}:${key}`;
}

export function edgeId(input: {
  kind: EdgeKind;
  srcId: string;
  dstId: string | null;
  honesty: Honesty;
  proof: BindingProof | null;
  unresolvedName?: string;
}): string {
  const loc = input.proof
    ? `${input.proof.span.startLine}:${input.proof.span.startCol}`
    : (input.unresolvedName ?? "0");
  return `edge:${input.kind}:${input.srcId}:${input.dstId ?? "none"}:${input.honesty}:${loc}`;
}

export function fileNode(input: {
  path: string;
  contentHash: string;
  language?: string;
  role?: FileRole;
}): FileNode {
  return {
    id: fileNodeId(input.path),
    kind: NodeKind.File,
    path: input.path,
    contentHash: input.contentHash,
    language: input.language,
    role: input.role ?? FileRole.Unknown,
  };
}

export function symbolNode(input: {
  file: string;
  name: string;
  symbolKind: SymbolKind;
  span: Span;
}): SymbolNode {
  return {
    id: symbolNodeId(input.file, input.name, input.symbolKind, input.span),
    kind: NodeKind.Symbol,
    file: input.file,
    name: input.name,
    symbolKind: input.symbolKind,
    span: input.span,
  };
}

export function entryNode(input: {
  file: string;
  protocol: string;
  key: string;
  qualifier?: string;
  name?: string;
  span?: Span;
}): EntryNode {
  const name =
    input.name ?? [input.qualifier, input.key].filter(Boolean).join(" ");
  return {
    id: entryNodeId(input.file, input.protocol, input.qualifier, input.key),
    kind: NodeKind.Entry,
    file: input.file,
    name,
    span: input.span,
    protocol: input.protocol,
    qualifier: input.qualifier,
    key: input.key,
  };
}

export function graphEdge(input: {
  kind: EdgeKind;
  srcId: string;
  honesty: Honesty;
  dstId?: string | null;
  proof?: BindingProof | null;
  candidates?: string[];
  unresolvedName?: string;
}): GraphEdge {
  const edge: GraphEdge = {
    kind: input.kind,
    srcId: input.srcId,
    dstId: input.dstId ?? null,
    honesty: input.honesty,
    proof: input.proof ?? null,
    candidates: input.candidates ? [...input.candidates] : [],
    unresolvedName: input.unresolvedName,
    id: "",
  };
  edge.id = edgeId(edge);
  return edge;
}

export function zeroSpan(): Span {
  return { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
}

/** Identity implication: a symbol or entry lives in its file. Not a resolved call. */
export function structuralContains(
  fileId: string,
  childId: string,
  filePath: string,
): GraphEdge {
  return graphEdge({
    kind: EdgeKind.Contains,
    srcId: fileId,
    dstId: childId,
    honesty: Honesty.Extracted,
    proof: {
      kind: ProofKind.SameFile,
      span: zeroSpan(),
      evidence: filePath,
    },
  });
}

export function nodeFile(node: GraphNode): string {
  return node.kind === NodeKind.File ? node.path : node.file;
}
