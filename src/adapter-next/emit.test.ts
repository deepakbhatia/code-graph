import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NextAdapter, collectSourceFiles } from "./index.ts";
import { EdgeKind, Honesty, GraphStore, impact, route } from "../kernel/index.ts";

const FIXTURES = resolve(process.cwd(), "fixtures");

async function load() {
  const files = await collectSourceFiles(FIXTURES);
  const batch = new NextAdapter().emit(files);
  const store = GraphStore.open();
  store.ingest(batch);
  return { files, batch, store };
}

describe("NextAdapter honesty", () => {
  it("does not EXTRACTED-call git Repo.save from an auth-bound Repo", async () => {
    const { batch } = await load();
    const extracted = batch.edges.filter(
      (edge) => edge.kind === EdgeKind.Calls && edge.honesty === Honesty.Extracted,
    );
    const gitSave = batch.nodes.find(
      (node) =>
        node.kind === "symbol" &&
        node.file.endsWith("git/repo.ts") &&
        node.name === "save",
    );
    expect(gitSave).toBeDefined();
    expect(extracted.some((edge) => edge.dstId === gitSave?.id)).toBe(false);
  });

  it("EXTRACTED-calls auth Repo.save when the import proves the binding", async () => {
    const { batch } = await load();
    const authSave = batch.nodes.find(
      (node) =>
        node.kind === "symbol" &&
        node.file.endsWith("auth/repo.ts") &&
        node.name === "save",
    );
    const run = batch.nodes.find(
      (node) =>
        node.kind === "symbol" &&
        node.file.endsWith("name-collision/app.ts") &&
        node.name === "run",
    );
    expect(
      batch.edges.some(
        (edge) =>
          edge.kind === EdgeKind.Calls &&
          edge.honesty === Honesty.Extracted &&
          edge.srcId === run?.id &&
          edge.dstId === authSave?.id,
      ),
    ).toBe(true);
  });

  it("leaves console.error unresolved and binds this.error locally", async () => {
    const { batch } = await load();
    const run = batch.nodes.find(
      (node) =>
        node.kind === "symbol" &&
        node.file.endsWith("local-error/handler.ts") &&
        node.name === "run",
    );
    const errorMethod = batch.nodes.find(
      (node) =>
        node.kind === "symbol" &&
        node.file.endsWith("local-error/handler.ts") &&
        node.name === "error",
    );
    const fromRun = batch.edges.filter(
      (edge) => edge.kind === EdgeKind.Calls && edge.srcId === run?.id,
    );
    expect(
      fromRun.some(
        (edge) =>
          edge.honesty === Honesty.Unresolved &&
          edge.unresolvedName === "error",
      ),
    ).toBe(true);
    expect(
      fromRun.some(
        (edge) =>
          edge.honesty === Honesty.Extracted && edge.dstId === errorMethod?.id,
      ),
    ).toBe(true);
  });

  it("does not turn a bare find() into a god node", async () => {
    const { batch } = await load();
    const main = batch.nodes.find(
      (node) =>
        node.kind === "symbol" &&
        node.file.endsWith("short-names/app.ts") &&
        node.name === "main",
    );
    const finds = batch.nodes.filter(
      (node) => node.kind === "symbol" && node.name === "find",
    );
    expect(finds.length).toBeGreaterThan(1);
    const extractedFinds = batch.edges.filter(
      (edge) =>
        edge.kind === EdgeKind.Calls &&
        edge.honesty === Honesty.Extracted &&
        edge.srcId === main?.id &&
        finds.some((node) => node.id === edge.dstId),
    );
    expect(extractedFinds).toEqual([]);
    expect(
      batch.edges.some(
        (edge) =>
          edge.kind === EdgeKind.Calls &&
          edge.srcId === main?.id &&
          edge.honesty === Honesty.Unresolved &&
          edge.unresolvedName === "find",
      ),
    ).toBe(true);
  });

  it("marks a two-class instance as AMBIGUOUS, not EXTRACTED", async () => {
    const { batch } = await load();
    const pick = batch.nodes.find(
      (node) =>
        node.kind === "symbol" &&
        node.file.endsWith("ambiguous-repo/app.ts") &&
        node.name === "pick",
    );
    const saves = batch.edges.filter(
      (edge) =>
        edge.kind === EdgeKind.Calls &&
        edge.srcId === pick?.id &&
        edge.unresolvedName === "save",
    );
    expect(saves.some((edge) => edge.honesty === Honesty.Ambiguous)).toBe(true);
    expect(saves.some((edge) => edge.honesty === Honesty.Extracted)).toBe(false);
  });
});

describe("NextAdapter entries", () => {
  it("emits POST /api/chat from an App Router route file", async () => {
    const { store } = await load();
    const result = route(store, {
      protocol: "http",
      qualifier: "POST",
      key: "/api/chat",
    });
    expect(result.entries).toHaveLength(1);
    expect(result.handlers[0]?.handler).toBeTruthy();
    expect(
      result.handlers[0]?.callees.some(
        (item) => item.node && "name" in item.node && item.node.name === "saveChat",
      ),
    ).toBe(true);
  });

  it("emits a server_action entry for use server exports", async () => {
    const { store } = await load();
    const result = route(store, {
      protocol: "server_action",
      key: "saveItem",
    });
    expect(result.entries).toHaveLength(1);
    expect(
      result.handlers[0]?.callees.some(
        (item) => item.node && "name" in item.node && item.node.name === "persist",
      ),
    ).toBe(true);
  });

  it("includes the test file that imports a module in impact", async () => {
    const { store } = await load();
    const run = store.listNodes({
      name: "run",
      file: "name-collision/app.ts",
    })[0];
    expect(run).toBeDefined();
    const result = impact(store, { id: run!.id });
    expect(result.testFiles.map((file) => file.path)).toContain(
      "name-collision/app.test.ts",
    );
  });
});
