import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NextAdapter, collectSourceFiles } from "../adapter-next/index.ts";
import { indexDirectory } from "../indexer.ts";
import { route } from "../kernel/index.ts";
import { extractedCalls, naiveCallClaims } from "./naive.ts";
import {
  formatScore,
  missingAmbiguous,
  missingEntries,
  missingUnresolved,
  scoreExtracted,
} from "./score.ts";

const FIXTURES = resolve(process.cwd(), "fixtures");
const CORPUS = resolve(process.cwd(), "corpus/ai-chatbot");

describe("fixture answer sheet", () => {
  it("scores name-only and code-graph against the written answers", async () => {
    const files = await collectSourceFiles(FIXTURES);
    const batch = new NextAdapter().emit(files);
    const naive = scoreExtracted("name-only", naiveCallClaims(files));
    const ours = scoreExtracted("code-graph", extractedCalls(batch));

    expect(ours.missingRequired, formatScore(ours)).toEqual([]);
    expect(ours.forbiddenHits, formatScore(ours)).toEqual([]);
    expect(ours.wrongEdgeRate).toBe(0);
    expect(missingUnresolved(batch)).toEqual([]);
    expect(missingAmbiguous(batch)).toEqual([]);
    expect(missingEntries(batch)).toEqual([]);

    expect(naive.forbiddenHits.length).toBeGreaterThan(0);
    expect(naive.wrongEdgeRate).toBeGreaterThan(ours.wrongEdgeRate);
  });
});

describe("corpus smoke", () => {
  it.skipIf(!existsSync(CORPUS))(
    "route POST /api/chat returns the handler and import-gated callees",
    async () => {
      const store = await indexDirectory(CORPUS, ":memory:");
      const result = route(store, {
        protocol: "http",
        qualifier: "POST",
        key: "/api/chat",
      });
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.handlers[0]?.handler).toBeTruthy();
      const extracted = result.handlers[0]?.callees.filter(
        (item) => item.edge.honesty === "EXTRACTED",
      );
      expect(extracted?.length).toBeGreaterThan(0);
      store.close();
    },
    120_000,
  );
});
