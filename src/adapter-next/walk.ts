import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceFile } from "../kernel/index.ts";
import {
  isSkippedDir,
  isSourceFile,
  relativeToRoot,
  toPosix,
} from "./paths.ts";

export async function collectSourceFiles(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  await walk(root, root, files);
  return files;
}

async function walk(root: string, dir: string, out: SourceFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) {
        continue;
      }
      await walk(root, join(dir, entry.name), out);
      continue;
    }
    const absolute = join(dir, entry.name);
    if (!isSourceFile(absolute)) {
      continue;
    }
    const path = relativeToRoot(root, absolute);
    if (path.startsWith("..")) {
      continue;
    }
    const content = await readFile(absolute, "utf8");
    out.push({
      path: toPosix(path),
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
    });
  }
}
