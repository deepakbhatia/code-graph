import { EdgeKind, Honesty, type GraphBatch } from "../kernel/index.ts";
import {
  mustBeExtracted,
  mustEntries,
  mustNeverBeExtracted,
  mustStayAmbiguous,
  mustStayUnresolved,
  type CallAnswer,
} from "./answer-key.ts";
import type { ClaimedCall } from "./naive.ts";

export interface ExtractorScore {
  name: string;
  extracted: number;
  missingRequired: CallAnswer[];
  forbiddenHits: ClaimedCall[];
  wrongEdgeRate: number;
}

export function sameCall(claim: ClaimedCall, answer: CallAnswer): boolean {
  return (
    claim.fromFile.endsWith(answer.fromFile) &&
    claim.fromName === answer.fromName &&
    claim.toFile.endsWith(answer.toFile) &&
    claim.toName === answer.toName
  );
}

export function scoreExtracted(name: string, extracted: ClaimedCall[]): ExtractorScore {
  const missingRequired = mustBeExtracted.filter(
    (answer) => !extracted.some((claim) => sameCall(claim, answer)),
  );
  const forbiddenHits = extracted.filter((claim) =>
    mustNeverBeExtracted.some((answer) => sameCall(claim, answer)),
  );
  return {
    name,
    extracted: extracted.length,
    missingRequired,
    forbiddenHits,
    wrongEdgeRate:
      extracted.length === 0 ? 0 : forbiddenHits.length / extracted.length,
  };
}

export function missingUnresolved(batch: GraphBatch): typeof mustStayUnresolved {
  return mustStayUnresolved.filter((answer) => !hasCallHonesty(batch, answer, Honesty.Unresolved));
}

export function missingAmbiguous(batch: GraphBatch): typeof mustStayAmbiguous {
  return mustStayAmbiguous.filter((answer) => {
    if (!hasCallHonesty(batch, answer, Honesty.Ambiguous)) {
      return true;
    }
    const edge = callEdges(batch).find(
      (item) =>
        item.edge.honesty === Honesty.Ambiguous &&
        item.src &&
        item.src.file.endsWith(answer.fromFile) &&
        item.src.name === answer.fromName &&
        item.edge.unresolvedName === answer.name,
    );
    if (!edge) {
      return true;
    }
    const destFiles = edge.edge.candidates
      .map((id) => batch.nodes.find((node) => node.id === id))
      .filter((node) => node !== undefined)
      .map((node) => node.file);
    return !answer.candidateFiles.every((file) =>
      destFiles.some((dest) => dest.endsWith(file)),
    );
  });
}

export function missingEntries(batch: GraphBatch): typeof mustEntries {
  return mustEntries.filter(
    (answer) =>
      !batch.nodes.some(
        (node) =>
          node.kind === "entry" &&
          node.protocol === answer.protocol &&
          node.key === answer.key &&
          (answer.qualifier === undefined || node.qualifier === answer.qualifier),
      ),
  );
}

export function formatScore(score: ExtractorScore): string {
  const rate = `${(score.wrongEdgeRate * 100).toFixed(0)}%`;
  return [
    `${score.name}: ${score.extracted} EXTRACTED, wrong-edge rate ${rate}`,
    score.missingRequired.length
      ? `  missing required: ${score.missingRequired.map(formatCall).join("; ")}`
      : "  missing required: none",
    score.forbiddenHits.length
      ? `  forbidden EXTRACTED: ${score.forbiddenHits.map(formatCall).join("; ")}`
      : "  forbidden EXTRACTED: none",
  ].join("\n");
}

function formatCall(call: CallAnswer | ClaimedCall): string {
  return `${call.fromFile} ${call.fromName} -> ${call.toFile} ${call.toName}`;
}

function callEdges(batch: GraphBatch) {
  const nodes = new Map(batch.nodes.map((node) => [node.id, node]));
  return batch.edges
    .filter((edge) => edge.kind === EdgeKind.Calls)
    .map((edge) => ({ edge, src: nodes.get(edge.srcId) }));
}

function hasCallHonesty(
  batch: GraphBatch,
  answer: { fromFile: string; fromName: string; name: string },
  honesty: typeof Honesty.Unresolved | typeof Honesty.Ambiguous,
): boolean {
  return callEdges(batch).some(
    ({ edge, src }) =>
      edge.honesty === honesty &&
      src &&
      src.file.endsWith(answer.fromFile) &&
      src.name === answer.fromName &&
      edge.unresolvedName === answer.name,
  );
}
