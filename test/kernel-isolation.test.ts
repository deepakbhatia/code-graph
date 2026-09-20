import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const KERNEL_DIR = new URL("../src/kernel/", import.meta.url);
const FORBIDDEN = ["app/api", "route.ts", "tsconfig", "PERFORM", "#include"];

async function kernelSources(dir: URL): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory()) {
      files.push(...(await kernelSources(url)));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(join(dir.pathname, entry.name));
    }
  }
  return files;
}

describe("kernel isolation", () => {
  it("does not embed framework or language frontend conventions", async () => {
    const files = await kernelSources(KERNEL_DIR);
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const token of FORBIDDEN) {
        if (source.includes(token)) {
          hits.push(`${file}: ${token}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
