import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { NextAdapter, collectSourceFiles } from "./adapter-next/index.ts";
import { GraphStore } from "./kernel/index.ts";

export const DEFAULT_DB = ".code-graph/graph.sqlite";

export async function indexDirectory(
  root: string,
  dbPath = DEFAULT_DB,
): Promise<GraphStore> {
  const files = await collectSourceFiles(root);
  const batch = new NextAdapter().emit(files);
  if (dbPath !== ":memory:") {
    await rm(dbPath, { force: true });
    await mkdir(dirname(dbPath), { recursive: true });
  }
  const store = GraphStore.open(dbPath);
  store.ingest(batch);
  store.checkFreshness(new Map(files.map((file) => [file.path, file.contentHash])));
  return store;
}

export function indexFiles(
  files: Parameters<NextAdapter["emit"]>[0],
  dbPath = ":memory:",
): GraphStore {
  const store = GraphStore.open(dbPath);
  store.ingest(new NextAdapter().emit(files));
  return store;
}
