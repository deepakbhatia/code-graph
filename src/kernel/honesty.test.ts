import { describe, expect, it } from "vitest";
import {
  HonestyError,
  assertHonestEdge,
  classifyResolution,
  weakestHonesty,
} from "./honesty.ts";
import {
  EdgeKind,
  Honesty,
  ProofKind,
  graphEdge,
  type BindingProof,
} from "./ir.ts";

const proof: BindingProof = {
  kind: ProofKind.Import,
  span: { startLine: 2, startCol: 0, endLine: 2, endCol: 20 },
  evidence: "Repo",
};

describe("classifyResolution", () => {
  it("is UNRESOLVED with no candidates", () => {
    expect(classifyResolution({ candidateIds: [], proof })).toEqual({
      honesty: Honesty.Unresolved,
      dstId: null,
      candidates: [],
    });
  });

  it("is EXTRACTED only with one candidate and a binding proof", () => {
    expect(
      classifyResolution({ candidateIds: ["symbol:a"], proof }),
    ).toEqual({
      honesty: Honesty.Extracted,
      dstId: "symbol:a",
      candidates: [],
    });
  });

  it("refuses to treat a name-only hit as EXTRACTED", () => {
    expect(
      classifyResolution({ candidateIds: ["symbol:a"], proof: null }),
    ).toEqual({
      honesty: Honesty.Unresolved,
      dstId: null,
      candidates: [],
    });
  });

  it("is AMBIGUOUS when two symbols share a name", () => {
    expect(
      classifyResolution({
        candidateIds: ["symbol:auth/Repo", "symbol:git/Repo"],
        proof,
      }),
    ).toEqual({
      honesty: Honesty.Ambiguous,
      dstId: null,
      candidates: ["symbol:auth/Repo", "symbol:git/Repo"],
    });
  });
});

describe("assertHonestEdge", () => {
  it("rejects EXTRACTED without a binding proof", () => {
    const edge = graphEdge({
      kind: EdgeKind.Calls,
      srcId: "fn",
      dstId: "other",
      honesty: Honesty.Extracted,
    });
    expect(() => assertHonestEdge(edge)).toThrow(HonestyError);
  });

  it("rejects EXTRACTED that still lists candidates", () => {
    const edge = graphEdge({
      kind: EdgeKind.Calls,
      srcId: "fn",
      dstId: "other",
      honesty: Honesty.Extracted,
      proof,
      candidates: ["other", "another"],
    });
    expect(() => assertHonestEdge(edge)).toThrow(HonestyError);
  });

  it("rejects AMBIGUOUS with a chosen destination", () => {
    const edge = graphEdge({
      kind: EdgeKind.Calls,
      srcId: "fn",
      dstId: "other",
      honesty: Honesty.Ambiguous,
      candidates: ["other", "another"],
    });
    expect(() => assertHonestEdge(edge)).toThrow(HonestyError);
  });

  it("accepts an import-proven call", () => {
    const edge = graphEdge({
      kind: EdgeKind.Calls,
      srcId: "fn",
      dstId: "other",
      honesty: Honesty.Extracted,
      proof,
    });
    expect(() => assertHonestEdge(edge)).not.toThrow();
  });
});

describe("weakestHonesty", () => {
  it("makes a path only as strong as its weakest edge", () => {
    expect(
      weakestHonesty([Honesty.Extracted, Honesty.Ambiguous, Honesty.Extracted]),
    ).toBe(Honesty.Ambiguous);
    expect(weakestHonesty([Honesty.Extracted, Honesty.Unresolved])).toBe(
      Honesty.Unresolved,
    );
  });
});
