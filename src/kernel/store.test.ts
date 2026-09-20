import { describe, expect, it } from "vitest";
import { EdgeKind, FileRole, Honesty, ProofKind, SymbolKind, fileNode, graphEdge, symbolNode } from "./ir.ts";
import { GraphStore } from "./store.ts";

const span = {
  startLine: 1,
  startCol: 0,
  endLine: 1,
  endCol: 4,
};

describe("GraphStore freshness", () => {
  it("names stale files instead of silently serving them", () => {
    const store = GraphStore.open();
    const file = fileNode({
      path: "mod.src",
      contentHash: "abc",
      role: FileRole.Source,
    });
    store.ingest({ files: [file], nodes: [], edges: [] });
    const stale = store.checkFreshness(new Map([["mod.src", "def"]]));
    expect(stale).toEqual([{ path: "mod.src", contentHash: "abc" }]);
    expect(store.staleFiles()).toEqual(stale);
  });

  it("clears stale when the hash matches again", () => {
    const store = GraphStore.open();
    const file = fileNode({
      path: "mod.src",
      contentHash: "abc",
      role: FileRole.Source,
    });
    store.ingest({ files: [file], nodes: [], edges: [] });
    store.checkFreshness(new Map([["mod.src", "nope"]]));
    store.checkFreshness(new Map([["mod.src", "abc"]]));
    expect(store.staleFiles()).toEqual([]);
  });
});

describe("GraphStore.replaceFile", () => {
  it("turns incoming EXTRACTED calls into UNRESOLVED when the callee disappears", () => {
    const store = GraphStore.open();
    const lib = fileNode({ path: "lib.src", contentHash: "1", role: FileRole.Source });
    const app = fileNode({ path: "app.src", contentHash: "1", role: FileRole.Source });
    const helper = symbolNode({
      file: lib.path,
      name: "helper",
      symbolKind: SymbolKind.Function,
      span,
    });
    const main = symbolNode({
      file: app.path,
      name: "main",
      symbolKind: SymbolKind.Function,
      span,
    });
    store.ingest({
      files: [lib, app],
      nodes: [helper, main],
      edges: [
        graphEdge({
          kind: EdgeKind.Calls,
          srcId: main.id,
          dstId: helper.id,
          honesty: Honesty.Extracted,
          proof: {
            kind: ProofKind.Import,
            span,
            evidence: "helper",
          },
        }),
      ],
    });

    store.replaceFile(lib, [], []);
    const leftover = store.listEdges({ srcId: main.id, kind: EdgeKind.Calls });
    expect(leftover).toHaveLength(1);
    expect(leftover[0]?.honesty).toBe(Honesty.Unresolved);
    expect(leftover[0]?.dstId).toBeNull();
    expect(store.getNode(helper.id)).toBeUndefined();
  });
});
