/** SQLite schema for the language-agnostic graph. No framework filenames or path conventions. */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  language TEXT,
  role TEXT NOT NULL DEFAULT 'unknown',
  indexed_at INTEGER NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'symbol', 'entry')),
  file TEXT,
  name TEXT NOT NULL,
  symbol_kind TEXT,
  start_line INTEGER,
  start_col INTEGER,
  end_line INTEGER,
  end_col INTEGER,
  protocol TEXT,
  qualifier TEXT,
  entry_key TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('contains', 'imports', 'calls', 'handles')),
  src_id TEXT NOT NULL,
  dst_id TEXT,
  honesty TEXT NOT NULL CHECK (honesty IN ('EXTRACTED', 'UNRESOLVED', 'AMBIGUOUS')),
  proof_kind TEXT,
  proof_start_line INTEGER,
  proof_start_col INTEGER,
  proof_end_line INTEGER,
  proof_end_col INTEGER,
  proof_evidence TEXT,
  unresolved_name TEXT
);

CREATE TABLE IF NOT EXISTS edge_candidates (
  edge_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  PRIMARY KEY (edge_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_entry ON nodes(protocol, qualifier, entry_key);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_files_stale ON files(stale);
`;
