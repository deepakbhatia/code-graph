import {
  EdgeKind,
  Honesty,
  type BindingProof,
  type GraphEdge,
} from "./ir.ts";

export class HonestyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HonestyError";
  }
}

export interface Resolution {
  honesty: Honesty;
  dstId: string | null;
  candidates: string[];
}

const RANK: Record<Honesty, number> = {
  [Honesty.Unresolved]: 0,
  [Honesty.Ambiguous]: 1,
  [Honesty.Extracted]: 2,
};

/**
 * Classify a binding. EXTRACTED only with exactly one candidate and a proof.
 * A name-only hit is UNRESOLVED — never a fake fact. Two or more candidates
 * are AMBIGUOUS and keep the candidate ids.
 */
export function classifyResolution(input: {
  candidateIds: readonly string[];
  proof: BindingProof | null;
}): Resolution {
  const unique = [...new Set(input.candidateIds.filter(Boolean))];
  if (unique.length === 0) {
    return { honesty: Honesty.Unresolved, dstId: null, candidates: [] };
  }
  if (unique.length === 1 && input.proof) {
    return { honesty: Honesty.Extracted, dstId: unique[0] ?? null, candidates: [] };
  }
  if (unique.length === 1) {
    return { honesty: Honesty.Unresolved, dstId: null, candidates: [] };
  }
  return {
    honesty: Honesty.Ambiguous,
    dstId: null,
    candidates: unique,
  };
}

/** A path is only as strong as its weakest edge. */
export function weakestHonesty(tags: readonly Honesty[]): Honesty | null {
  if (tags.length === 0) {
    return null;
  }
  return tags.reduce((weak, tag) =>
    RANK[tag] < RANK[weak] ? tag : weak,
  );
}

export function isStructuralEdge(kind: EdgeKind): boolean {
  return kind === EdgeKind.Contains;
}

export function assertHonestEdge(edge: GraphEdge): void {
  if (isStructuralEdge(edge.kind)) {
    if (!edge.dstId) {
      throw new HonestyError("contains edges require a destination");
    }
    if (edge.honesty !== Honesty.Extracted) {
      throw new HonestyError("contains edges are structural and must be EXTRACTED");
    }
    if (!edge.proof) {
      throw new HonestyError("contains edges need a same-file proof");
    }
    return;
  }

  switch (edge.honesty) {
    case Honesty.Extracted:
      if (!edge.dstId) {
        throw new HonestyError("EXTRACTED requires a destination node");
      }
      if (!edge.proof) {
        throw new HonestyError(
          "EXTRACTED requires a binding proof; name-only matches are not facts",
        );
      }
      if (edge.candidates.length > 0) {
        throw new HonestyError("EXTRACTED cannot carry unresolved candidates");
      }
      break;
    case Honesty.Ambiguous:
      if (edge.dstId) {
        throw new HonestyError("AMBIGUOUS must not pick a destination");
      }
      if (edge.candidates.length < 2) {
        throw new HonestyError("AMBIGUOUS requires at least two candidates");
      }
      break;
    case Honesty.Unresolved:
      if (edge.dstId) {
        throw new HonestyError("UNRESOLVED must not pick a destination");
      }
      break;
    default: {
      const _never: never = edge.honesty;
      throw new HonestyError(`unknown honesty tag: ${String(_never)}`);
    }
  }
}
