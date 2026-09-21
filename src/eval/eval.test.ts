import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NextAdapter, collectSourceFiles } from "../adapter-next/index.ts";
import { indexDirectory } from "../indexer.ts";
import { route } from "../kernel/index.ts";
import { extractedCalls, naiveCallClaims } from "./naive.ts";

const FIXTURES = resolve(process.cwd(), "fixtures");
const CORPUS = resolve(process.cwd(), "corpus/ai-chatbot");

describe("wrong-edge rate vs name-only matching", () => {
  it("Graphify-shaped name matching emits fake EXTRACTED calls; we do not", async () => {
    const files = await collectSourceFiles(FIXTURES);
    const batch = new NextAdapter().emit(files);
    const naive = naiveCallClaims(files);
    const honest = extractedCalls(batch);
    const honestKeys = new Set(
      honest.map((claim) => `${claim.fromFile}:${claim.fromName}->${claim.toFile}:${claim.toName}`),
    );
    const wrong = naive.filter(
      (claim) =>
        !honestKeys.has(`${claim.fromFile}:${claim.fromName}->${claim.toFile}:${claim.toName}`),
    );
    expect(naive.length).toBeGreaterThan(honest.length);
    expect(wrong.length).toBeGreaterThan(0);
    expect(
      wrong.some(
        (claim) =>
          claim.fromFile.endsWith("name-collision/app.ts") &&
          claim.toFile.endsWith("git/repo.ts") &&
          claim.callee === "save",
      ),
    ).toBe(true);
    expect(
      honest.some(
        (claim) =>
          claim.fromFile.endsWith("name-collision/app.ts") &&
          claim.toFile.endsWith("git/repo.ts"),
      ),
    ).toBe(false);
    const rate = wrong.length / naive.length;
    expect(rate).toBeGreaterThan(0);
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
