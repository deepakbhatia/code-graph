import { DatabaseSync } from "node:sqlite";
import { HonestyError, assertHonestEdge, isStructuralEdge } from "./honesty.ts";
import {
  FileRole,
  Honesty,
  NodeKind,
  fileNode,
  fileNodeId,
  structuralContains,
  type BindingProof,
  type EntryNode,
  type FileNode,
  type GraphBatch,
  type GraphEdge,
  type GraphNode,
  type ProofKind,
  type Span,
  type SymbolKind,
  type SymbolNode,
} from "./ir.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

interface FileRow {
  path: string;
  content_hash: string;
  language: string | null;
  role: string;
  indexed_at: number;
  stale: number;
}

interface NodeRow {
  id: string;
  kind: string;
  file: string | null;
  name: string;
  symbol_kind: string | null;
  start_line: number | null;
  start_col: number | null;
  end_line: number | null;
  end_col: number | null;
  protocol: string | null;
  qualifier: string | null;
  entry_key: string | null;
}

function asRows<T>(value: unknown): T[] {
  return value as T[];
}

function asRow<T>(value: unknown): T | undefined {
  return (value ?? undefined) as T | undefined;
}

interface EdgeRow {
  id: string;
  kind: string;
  src_id: string;
  dst_id: string | null;
  honesty: string;
  proof_kind: string | null;
  proof_start_line: number | null;
  proof_start_col: number | null;
  proof_end_line: number | null;
  proof_end_col: number | null;
  proof_evidence: string | null;
  unresolved_name: string | null;
}

export interface StaleFile {
  path: string;
  contentHash: string;
}

export class GraphStore {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(path = ":memory:"): GraphStore {
    const db = new DatabaseSync(path);
    db.exec(SCHEMA_SQL);
    const store = new GraphStore(db);
    store.setMeta("schema_version", String(SCHEMA_VERSION));
    return store;
  }

  close(): void {
    this.db.close();
  }

  ingest(batch: GraphBatch): void {
    this.transaction(() => {
      for (const file of batch.files) {
        this.upsertFile(file);
        this.upsertNode(file);
      }
      for (const node of batch.nodes) {
        this.ensureFileRecord(node.file);
        this.upsertNode(node);
        this.upsertEdge(structuralContains(fileNodeId(node.file), node.id, node.file));
      }
      for (const edge of batch.edges) {
        this.upsertEdge(edge);
      }
    });
  }

  replaceFile(
    file: FileNode,
    nodes: Array<SymbolNode | EntryNode>,
    edges: GraphEdge[],
  ): void {
    this.transaction(() => {
      this.downgradeIncoming(file.path);
      this.deleteOriginating(file.path);
      this.upsertFile(file);
      this.upsertNode(file);
      for (const node of nodes) {
        if (node.file !== file.path) {
          throw new HonestyError(
            `node ${node.id} belongs to ${node.file}, not ${file.path}`,
          );
        }
        this.upsertNode(node);
        this.upsertEdge(structuralContains(file.id, node.id, file.path));
      }
      for (const edge of edges) {
        this.upsertEdge(edge);
      }
    });
  }

  removeFile(path: string): void {
    this.transaction(() => {
      this.downgradeIncoming(path);
      this.deleteOriginating(path);
      this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
    });
  }

  checkFreshness(observed: ReadonlyMap<string, string>): StaleFile[] {
    const rows = asRows<FileRow>(this.db.prepare("SELECT * FROM files").all());
    const stale: StaleFile[] = [];
    for (const row of rows) {
      const hash = observed.get(row.path);
      const isStale = hash === undefined || hash !== row.content_hash;
      this.db
        .prepare("UPDATE files SET stale = ? WHERE path = ?")
        .run(isStale ? 1 : 0, row.path);
      if (isStale) {
        stale.push({ path: row.path, contentHash: row.content_hash });
      }
    }
    return stale;
  }

  markStale(paths: readonly string[]): void {
    const stmt = this.db.prepare("UPDATE files SET stale = 1 WHERE path = ?");
    for (const path of paths) {
      stmt.run(path);
    }
  }

  staleFiles(): StaleFile[] {
    const rows = asRows<{ path: string; content_hash: string }>(
      this.db.prepare("SELECT path, content_hash FROM files WHERE stale = 1").all(),
    );
    return rows.map((row) => ({ path: row.path, contentHash: row.content_hash }));
  }

  getNode(id: string): GraphNode | undefined {
    const row = asRow<NodeRow>(this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id));
    return row ? this.rowToNode(row) : undefined;
  }

  getFile(path: string): FileNode | undefined {
    const row = asRow<FileRow>(
      this.db.prepare("SELECT * FROM files WHERE path = ?").get(path),
    );
    return row ? this.rowToFile(row) : undefined;
  }

  listNodes(filter: {
    name?: string;
    file?: string;
    kind?: string;
    symbolKind?: string;
    id?: string;
    protocol?: string;
    qualifier?: string;
    entryKey?: string;
  }): GraphNode[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (filter.id) {
      clauses.push("id = :id");
      params.id = filter.id;
    }
    if (filter.name) {
      clauses.push("name = :name");
      params.name = filter.name;
    }
    if (filter.file) {
      clauses.push("file = :file");
      params.file = filter.file;
    }
    if (filter.kind) {
      clauses.push("kind = :kind");
      params.kind = filter.kind;
    }
    if (filter.symbolKind) {
      clauses.push("symbol_kind = :symbolKind");
      params.symbolKind = filter.symbolKind;
    }
    if (filter.protocol) {
      clauses.push("protocol = :protocol");
      params.protocol = filter.protocol;
    }
    if (filter.qualifier) {
      clauses.push("qualifier = :qualifier");
      params.qualifier = filter.qualifier;
    }
    if (filter.entryKey) {
      clauses.push("entry_key = :entryKey");
      params.entryKey = filter.entryKey;
    }
    const sql =
      clauses.length === 0
        ? "SELECT * FROM nodes"
        : `SELECT * FROM nodes WHERE ${clauses.join(" AND ")}`;
    const stmt = this.db.prepare(sql);
    const rows = asRows<NodeRow>(clauses.length === 0 ? stmt.all() : stmt.all(params));
    return rows.map((row) => this.rowToNode(row));
  }

  listEdges(filter: { srcId?: string; dstId?: string; kind?: string }): GraphEdge[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (filter.srcId) {
      clauses.push("src_id = :srcId");
      params.srcId = filter.srcId;
    }
    if (filter.dstId) {
      clauses.push("dst_id = :dstId");
      params.dstId = filter.dstId;
    }
    if (filter.kind) {
      clauses.push("kind = :kind");
      params.kind = filter.kind;
    }
    const sql =
      clauses.length === 0
        ? "SELECT * FROM edges"
        : `SELECT * FROM edges WHERE ${clauses.join(" AND ")}`;
    const stmt = this.db.prepare(sql);
    const rows = asRows<EdgeRow>(clauses.length === 0 ? stmt.all() : stmt.all(params));
    return rows.map((row) => this.rowToEdge(row));
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  private upsertFile(file: FileNode): void {
    this.db
      .prepare(
        `INSERT INTO files (path, content_hash, language, role, indexed_at, stale)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(path) DO UPDATE SET
           content_hash = excluded.content_hash,
           language = excluded.language,
           role = excluded.role,
           indexed_at = excluded.indexed_at,
           stale = 0`,
      )
      .run(file.path, file.contentHash, file.language ?? null, file.role, Date.now());
  }

  private ensureFileRecord(path: string): void {
    const existing = this.getFile(path);
    if (existing) {
      this.upsertNode(existing);
      return;
    }
    const created = fileNode({ path, contentHash: "unknown", role: FileRole.Unknown });
    this.upsertFile(created);
    this.upsertNode(created);
  }

  private upsertNode(node: GraphNode): void {
    if (node.kind === NodeKind.File) {
      this.db
        .prepare(
          `INSERT INTO nodes (id, kind, file, name, symbol_kind, start_line, start_col, end_line, end_col, protocol, qualifier, entry_key)
           VALUES (?, 'file', ?, ?, 'file', NULL, NULL, NULL, NULL, NULL, NULL, NULL)
           ON CONFLICT(id) DO UPDATE SET file = excluded.file, name = excluded.name`,
        )
        .run(node.id, node.path, node.path);
      return;
    }
    if (node.kind === NodeKind.Symbol) {
      this.db
        .prepare(
          `INSERT INTO nodes (id, kind, file, name, symbol_kind, start_line, start_col, end_line, end_col, protocol, qualifier, entry_key)
           VALUES (?, 'symbol', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
           ON CONFLICT(id) DO UPDATE SET
             file = excluded.file,
             name = excluded.name,
             symbol_kind = excluded.symbol_kind,
             start_line = excluded.start_line,
             start_col = excluded.start_col,
             end_line = excluded.end_line,
             end_col = excluded.end_col`,
        )
        .run(
          node.id,
          node.file,
          node.name,
          node.symbolKind,
          node.span.startLine,
          node.span.startCol,
          node.span.endLine,
          node.span.endCol,
        );
      return;
    }
    this.db
      .prepare(
        `INSERT INTO nodes (id, kind, file, name, symbol_kind, start_line, start_col, end_line, end_col, protocol, qualifier, entry_key)
         VALUES (?, 'entry', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           file = excluded.file,
           name = excluded.name,
           start_line = excluded.start_line,
           start_col = excluded.start_col,
           end_line = excluded.end_line,
           end_col = excluded.end_col,
           protocol = excluded.protocol,
           qualifier = excluded.qualifier,
           entry_key = excluded.entry_key`,
      )
      .run(
        node.id,
        node.file,
        node.name,
        node.span?.startLine ?? null,
        node.span?.startCol ?? null,
        node.span?.endLine ?? null,
        node.span?.endCol ?? null,
        node.protocol,
        node.qualifier ?? null,
        node.key,
      );
  }

  private upsertEdge(edge: GraphEdge): void {
    assertHonestEdge(edge);
    if (edge.honesty === Honesty.Extracted && edge.dstId && !this.getNode(edge.dstId)) {
      throw new HonestyError(`EXTRACTED destination ${edge.dstId} is not in the graph`);
    }
    for (const candidate of edge.candidates) {
      if (!this.getNode(candidate)) {
        throw new HonestyError(`AMBIGUOUS candidate ${candidate} is not in the graph`);
      }
    }
    this.db.prepare("DELETE FROM edge_candidates WHERE edge_id = ?").run(edge.id);
    this.db
      .prepare(
        `INSERT INTO edges (
           id, kind, src_id, dst_id, honesty,
           proof_kind, proof_start_line, proof_start_col, proof_end_line, proof_end_col, proof_evidence,
           unresolved_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           src_id = excluded.src_id,
           dst_id = excluded.dst_id,
           honesty = excluded.honesty,
           proof_kind = excluded.proof_kind,
           proof_start_line = excluded.proof_start_line,
           proof_start_col = excluded.proof_start_col,
           proof_end_line = excluded.proof_end_line,
           proof_end_col = excluded.proof_end_col,
           proof_evidence = excluded.proof_evidence,
           unresolved_name = excluded.unresolved_name`,
      )
      .run(
        edge.id,
        edge.kind,
        edge.srcId,
        edge.dstId,
        edge.honesty,
        edge.proof?.kind ?? null,
        edge.proof?.span.startLine ?? null,
        edge.proof?.span.startCol ?? null,
        edge.proof?.span.endLine ?? null,
        edge.proof?.span.endCol ?? null,
        edge.proof?.evidence ?? null,
        edge.unresolvedName ?? null,
      );
    const insertCandidate = this.db.prepare(
      "INSERT INTO edge_candidates (edge_id, node_id) VALUES (?, ?)",
    );
    for (const candidate of edge.candidates) {
      insertCandidate.run(edge.id, candidate);
    }
  }

  private originatingNodeIds(path: string): string[] {
    const rows = asRows<{ id: string }>(
      this.db.prepare("SELECT id FROM nodes WHERE file = ? AND kind != 'file'").all(path),
    );
    return rows.map((row) => row.id);
  }

  private downgradeIncoming(path: string): void {
    const dying = new Set(this.originatingNodeIds(path));
    if (dying.size === 0) {
      return;
    }
    const edges = this.listEdges({});
    for (const edge of edges) {
      if (isStructuralEdge(edge.kind) || dying.has(edge.srcId)) {
        continue;
      }
      if (edge.dstId && dying.has(edge.dstId)) {
        const lost = this.getNode(edge.dstId);
        this.upsertEdge({
          ...edge,
          dstId: null,
          honesty: Honesty.Unresolved,
          proof: null,
          candidates: [],
          unresolvedName: edge.unresolvedName ?? (lost && lost.kind !== NodeKind.File ? lost.name : edge.dstId),
        });
        continue;
      }
      if (edge.candidates.some((id) => dying.has(id))) {
        const remaining = edge.candidates.filter((id) => !dying.has(id));
        if (remaining.length >= 2) {
          this.upsertEdge({ ...edge, candidates: remaining });
        } else {
          this.upsertEdge({
            ...edge,
            dstId: null,
            honesty: Honesty.Unresolved,
            proof: null,
            candidates: [],
            unresolvedName: edge.unresolvedName,
          });
        }
      }
    }
  }

  private deleteOriginating(path: string): void {
    const ids = this.originatingNodeIds(path);
    const fileId = fileNodeId(path);
    if (ids.length === 0) {
      this.db.prepare("DELETE FROM edges WHERE src_id = ?").run(fileId);
      this.db.prepare("DELETE FROM nodes WHERE id = ?").run(fileId);
      return;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const srcOrDst = [...ids, fileId];
    const allPlaceholders = srcOrDst.map(() => "?").join(", ");
    this.db
      .prepare(
        `DELETE FROM edge_candidates WHERE edge_id IN (
           SELECT id FROM edges WHERE src_id IN (${allPlaceholders}) OR dst_id IN (${placeholders})
         ) OR node_id IN (${placeholders})`,
      )
      .run(...srcOrDst, ...ids, ...ids);
    this.db
      .prepare(
        `DELETE FROM edges WHERE src_id IN (${allPlaceholders}) OR dst_id IN (${placeholders})`,
      )
      .run(...srcOrDst, ...ids);
    this.db.prepare(`DELETE FROM nodes WHERE id IN (${placeholders})`).run(...ids);
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(fileId);
  }

  private rowToFile(row: FileRow): FileNode {
    return {
      id: fileNodeId(row.path),
      kind: NodeKind.File,
      path: row.path,
      contentHash: row.content_hash,
      language: row.language ?? undefined,
      role: row.role as FileRole,
    };
  }

  private rowToNode(row: NodeRow): GraphNode {
    if (row.kind === NodeKind.File) {
      const file = this.getFile(row.file ?? row.name);
      return (
        file ??
        fileNode({
          path: row.file ?? row.name,
          contentHash: "unknown",
          role: FileRole.Unknown,
        })
      );
    }
    const span: Span | undefined =
      row.start_line === null || row.start_col === null
        ? undefined
        : {
            startLine: row.start_line,
            startCol: row.start_col,
            endLine: row.end_line ?? row.start_line,
            endCol: row.end_col ?? row.start_col,
          };
    if (row.kind === NodeKind.Entry) {
      return {
        id: row.id,
        kind: NodeKind.Entry,
        file: row.file ?? "",
        name: row.name,
        span,
        protocol: row.protocol ?? "",
        qualifier: row.qualifier ?? undefined,
        key: row.entry_key ?? row.name,
      };
    }
    return {
      id: row.id,
      kind: NodeKind.Symbol,
      file: row.file ?? "",
      name: row.name,
      symbolKind: (row.symbol_kind ?? "unknown") as SymbolKind,
      span: span ?? { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    };
  }

  private rowToEdge(row: EdgeRow): GraphEdge {
    const candidateRows = asRows<{ node_id: string }>(
      this.db.prepare("SELECT node_id FROM edge_candidates WHERE edge_id = ?").all(row.id),
    );
    const proof: BindingProof | null =
      row.proof_kind && row.proof_start_line !== null && row.proof_start_col !== null
        ? {
            kind: row.proof_kind as ProofKind,
            span: {
              startLine: row.proof_start_line,
              startCol: row.proof_start_col,
              endLine: row.proof_end_line ?? row.proof_start_line,
              endCol: row.proof_end_col ?? row.proof_start_col,
            },
            evidence: row.proof_evidence ?? "",
          }
        : null;
    return {
      id: row.id,
      kind: row.kind as GraphEdge["kind"],
      srcId: row.src_id,
      dstId: row.dst_id,
      honesty: row.honesty as Honesty,
      proof,
      candidates: candidateRows.map((c) => c.node_id),
      unresolvedName: row.unresolved_name ?? undefined,
    };
  }
}