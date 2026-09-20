import { describe, expect, it } from "vitest";
import {
  HonestyError,
  classifyResolution,
} from "./honesty.ts";
import {
  EdgeKind,
  FileRole,
  Honesty,
  ProofKind,
  SymbolKind,
  entryNode,
  fileNode,
  graphEdge,
  symbolNode,
  type BindingProof,
  type GraphBatch,
  type Span,
} from "./ir.ts";
import { impact, lookup, path, route } from "./queries.ts";
import { GraphStore } from "./store.ts";

const span = (line: number): Span => ({
  startLine: line,
  startCol: 0,
  endLine: line,
  endCol: 8,
});

const proof = (evidence: string, line: number): BindingProof => ({
  kind: ProofKind.Import,
  span: span(line),
  evidence,
});

const localProof = (evidence: string, line: number): BindingProof => ({
  kind: ProofKind.Local,
  span: span(line),
  evidence,
});

function provenCall(srcId: string, dstId: string, evidence: string, line: number) {
  const decision = classifyResolution({
    candidateIds: [dstId],
    proof: proof(evidence, line),
  });
  return graphEdge({
    kind: EdgeKind.Calls,
    srcId,
    ...decision,
    proof: proof(evidence, line),
  });
}

function loadFixture(): { store: GraphStore; ids: Record<string, string> } {
  const authFile = fileNode({
    path: "auth/repo.src",
    contentHash: "h-auth",
    role: FileRole.Source,
    language: "text",
  });
  const gitFile = fileNode({
    path: "git/repo.src",
    contentHash: "h-git",
    role: FileRole.Source,
    language: "text",
  });
  const handlerFile = fileNode({
    path: "svc/handler.src",
    contentHash: "h-handler",
    role: FileRole.Source,
    language: "text",
  });
  const testFile = fileNode({
    path: "svc/handler.check",
    contentHash: "h-test",
    role: FileRole.Test,
    language: "text",
  });
  const decoyTestName = fileNode({
    path: "svc/handler.test.src",
    contentHash: "h-decoy",
    role: FileRole.Source,
    language: "text",
  });

  const authRepo = symbolNode({
    file: authFile.path,
    name: "Repo",
    symbolKind: SymbolKind.Class,
    span: span(1),
  });
  const gitRepo = symbolNode({
    file: gitFile.path,
    name: "Repo",
    symbolKind: SymbolKind.Class,
    span: span(1),
  });
  const save = symbolNode({
    file: handlerFile.path,
    name: "save",
    symbolKind: SymbolKind.Function,
    span: span(4),
  });
  const postItems = symbolNode({
    file: handlerFile.path,
    name: "postItems",
    symbolKind: SymbolKind.Function,
    span: span(10),
  });
  const batchMain = symbolNode({
    file: handlerFile.path,
    name: "batchMain",
    symbolKind: SymbolKind.Function,
    span: span(20),
  });
  const log = symbolNode({
    file: handlerFile.path,
    name: "log",
    symbolKind: SymbolKind.Function,
    span: span(2),
  });

  const httpEntry = entryNode({
    file: handlerFile.path,
    protocol: "http",
    qualifier: "POST",
    key: "/v1/items",
    span: span(10),
  });
  const programEntry = entryNode({
    file: handlerFile.path,
    protocol: "program",
    key: "BATCH01",
    span: span(20),
  });

  const handleProof: BindingProof = {
    kind: ProofKind.EntryBinding,
    span: span(10),
    evidence: "POST /v1/items",
  };
  const programProof: BindingProof = {
    kind: ProofKind.EntryBinding,
    span: span(20),
    evidence: "BATCH01",
  };

  const batch: GraphBatch = {
    files: [authFile, gitFile, handlerFile, testFile, decoyTestName],
    nodes: [authRepo, gitRepo, save, postItems, batchMain, log, httpEntry, programEntry],
    edges: [
      provenCall(postItems.id, save.id, "save", 12),
      graphEdge({
        kind: EdgeKind.Calls,
        srcId: postItems.id,
        unresolvedName: "find",
        ...classifyResolution({ candidateIds: [], proof: null }),
      }),
      graphEdge({
        kind: EdgeKind.Calls,
        srcId: save.id,
        unresolvedName: "Repo",
        ...classifyResolution({
          candidateIds: [authRepo.id, gitRepo.id],
          proof: null,
        }),
      }),
      graphEdge({
        kind: EdgeKind.Handles,
        srcId: httpEntry.id,
        dstId: postItems.id,
        honesty: Honesty.Extracted,
        proof: handleProof,
      }),
      graphEdge({
        kind: EdgeKind.Handles,
        srcId: programEntry.id,
        dstId: batchMain.id,
        honesty: Honesty.Extracted,
        proof: programProof,
      }),
      graphEdge({
        kind: EdgeKind.Calls,
        srcId: batchMain.id,
        dstId: log.id,
        honesty: Honesty.Extracted,
        proof: localProof("log", 21),
      }),
      graphEdge({
        kind: EdgeKind.Imports,
        srcId: testFile.id,
        dstId: handlerFile.id,
        honesty: Honesty.Extracted,
        proof: proof("./handler", 1),
      }),
    ],
  };

  const store = GraphStore.open();
  store.ingest(batch);
  return {
    store,
    ids: {
      postItems: postItems.id,
      save: save.id,
      authRepo: authRepo.id,
      gitRepo: gitRepo.id,
      httpEntry: httpEntry.id,
      programEntry: programEntry.id,
      batchMain: batchMain.id,
      log: log.id,
      testFile: testFile.id,
      decoy: decoyTestName.id,
    },
  };
}

describe("lookup", () => {
  it("finds symbols by name without picking a collision", () => {
    const { store } = loadFixture();
    const result = lookup(store, { name: "Repo" });
    expect(result.nodes.map((node) => node.kind)).toEqual(["symbol", "symbol"]);
    expect(
      result.nodes.map((node) => ("file" in node ? node.file : "")).sort(),
    ).toEqual(["auth/repo.src", "git/repo.src"]);
  });
});

describe("impact", () => {
  it("returns callers, callees, and test files that import the module", () => {
    const { store, ids } = loadFixture();
    const result = impact(store, { id: ids.save });
    expect(result.symbol && "name" in result.symbol ? result.symbol.name : null).toBe(
      "save",
    );
    expect(result.callers.map((c) => c.node && "name" in c.node ? c.node.name : null)).toEqual([
      "postItems",
    ]);
    expect(result.callees).toHaveLength(2);
    expect(result.callees.every((item) => item.edge.honesty === Honesty.Ambiguous)).toBe(
      true,
    );
    expect(
      result.callees
        .map((item) => item.node?.id)
        .filter((id): id is string => id !== undefined)
        .sort(),
    ).toEqual([ids.authRepo, ids.gitRepo].sort());
    expect(result.testFiles.map((file) => file.path)).toEqual(["svc/handler.check"]);
  });

  it("does not treat a source file as a test because of its name", () => {
    const { store, ids } = loadFixture();
    const result = impact(store, { id: ids.save });
    expect(result.testFiles.map((file) => file.path)).not.toContain(
      "svc/handler.test.src",
    );
  });

  it("refuses to invent a blast radius when the name is ambiguous", () => {
    const { store } = loadFixture();
    const result = impact(store, { name: "Repo" });
    expect(result.matches).toHaveLength(2);
    expect(result.symbol).toBeNull();
    expect(result.callers).toEqual([]);
  });
});

describe("path", () => {
  it("reports strength as the weakest hop", () => {
    const { store, ids } = loadFixture();
    const result = path(store, { fromId: ids.postItems, toId: ids.authRepo });
    expect(result.found).toBe(true);
    expect(result.strength).toBe(Honesty.Ambiguous);
  });

  it("does not walk UNRESOLVED edges", () => {
    const { store, ids } = loadFixture();
    const missing = path(store, { fromId: ids.postItems, toId: "symbol:nowhere" });
    expect(missing.found).toBe(false);
  });
});

describe("route", () => {
  it("finds an HTTP entry by protocol, qualifier, and key", () => {
    const { store, ids } = loadFixture();
    const result = route(store, {
      protocol: "http",
      qualifier: "POST",
      key: "/v1/items",
    });
    expect(result.entries).toHaveLength(1);
    expect(result.handlers[0]?.handler && "id" in result.handlers[0].handler).toBe(
      true,
    );
    expect(result.handlers[0]?.handler?.id).toBe(ids.postItems);
    expect(
      result.handlers[0]?.callees.map((c) =>
        c.node && "name" in c.node ? c.node.name : c.edge.unresolvedName,
      ),
    ).toEqual(["save", "find"]);
  });

  it("finds a program entry the same way — no framework filename logic", () => {
    const { store, ids } = loadFixture();
    const result = route(store, { protocol: "program", key: "BATCH01" });
    expect(result.handlers[0]?.handler?.id).toBe(ids.batchMain);
    expect(result.handlers[0]?.callees[0]?.node?.id).toBe(ids.log);
  });
});

describe("ingest honesty", () => {
  it("rejects a fake EXTRACTED call at the store boundary", () => {
    const store = GraphStore.open();
    const file = fileNode({ path: "a.src", contentHash: "1", role: FileRole.Source });
    const caller = symbolNode({
      file: file.path,
      name: "a",
      symbolKind: SymbolKind.Function,
      span: span(1),
    });
    const callee = symbolNode({
      file: file.path,
      name: "b",
      symbolKind: SymbolKind.Function,
      span: span(2),
    });
    expect(() =>
      store.ingest({
        files: [file],
        nodes: [caller, callee],
        edges: [
          graphEdge({
            kind: EdgeKind.Calls,
            srcId: caller.id,
            dstId: callee.id,
            honesty: Honesty.Extracted,
          }),
        ],
      }),
    ).toThrow(HonestyError);
  });
});
