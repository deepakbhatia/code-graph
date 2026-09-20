import type { GraphBatch } from "./ir.ts";

/** A file the adapter may parse. The kernel never opens these. */
export interface SourceFile {
  path: string;
  content: string;
  contentHash: string;
}

/**
 * Adapter contract. Each language/framework frontend implements this and
 * emits IR. Resolution and entry discovery belong here, not in the kernel.
 */
export interface GraphAdapter {
  readonly id: string;
  emit(files: readonly SourceFile[]): GraphBatch;
}
