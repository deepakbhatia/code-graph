import {
  EdgeKind,
  Honesty,
  type GraphBatch,
  type SourceFile,
} from "../kernel/index.ts";
import { parseSource, type SyntaxNode } from "../adapter-next/parse.ts";

export interface ClaimedCall {
  fromFile: string;
  fromName: string;
  toFile: string;
  toName: string;
  callee: string;
}

/** Name-only EXTRACTED claims — the Graphify-shaped lie. */
export function naiveCallClaims(files: readonly SourceFile[]): ClaimedCall[] {
  const symbols: Array<{ file: string; name: string }> = [];
  const calls: Array<{ file: string; fromName: string; callee: string }> = [];
  for (const file of files) {
    const root = parseSource(file.path, file.content);
    collectNaive(root, file.path, symbols, calls, null);
  }
  const claims: ClaimedCall[] = [];
  for (const call of calls) {
    for (const symbol of symbols) {
      if (symbol.name === call.callee) {
        claims.push({
          fromFile: call.file,
          fromName: call.fromName,
          toFile: symbol.file,
          toName: symbol.name,
          callee: call.callee,
        });
      }
    }
  }
  return claims;
}

export function extractedCalls(batch: GraphBatch): ClaimedCall[] {
  const nodes = new Map(batch.nodes.map((node) => [node.id, node]));
  const claims: ClaimedCall[] = [];
  for (const edge of batch.edges) {
    if (edge.kind !== EdgeKind.Calls || edge.honesty !== Honesty.Extracted || !edge.dstId) {
      continue;
    }
    const src = nodes.get(edge.srcId);
    const dst = nodes.get(edge.dstId);
    if (!src || !dst) {
      continue;
    }
    claims.push({
      fromFile: src.file,
      fromName: src.name,
      toFile: dst.file,
      toName: dst.name,
      callee: dst.name,
    });
  }
  return claims;
}

function collectNaive(
  node: SyntaxNode,
  file: string,
  symbols: Array<{ file: string; name: string }>,
  calls: Array<{ file: string; fromName: string; callee: string }>,
  fromName: string | null,
): void {
  let nextFrom = fromName;
  if (
    node.type === "function_declaration" ||
    node.type === "method_definition" ||
    node.type === "class_declaration"
  ) {
    const name = node.childForFieldName("name");
    if (name) {
      symbols.push({ file, name: name.text });
      nextFrom = name.text;
    }
  }
  if (node.type === "call_expression" || node.type === "new_expression") {
    const callee =
      node.childForFieldName("function") ??
      node.childForFieldName("constructor") ??
      node.namedChildren[0];
    const name =
      callee?.type === "identifier"
        ? callee.text
        : callee?.childForFieldName("property")?.text;
    if (name && nextFrom) {
      calls.push({ file, fromName: nextFrom, callee: name });
    }
  }
  for (const child of node.namedChildren) {
    collectNaive(child, file, symbols, calls, nextFrom);
  }
}
