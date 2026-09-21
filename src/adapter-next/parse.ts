import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Parser = require("tree-sitter") as {
  new (): {
    setLanguage(language: unknown): void;
    parse(input: string, oldTree?: unknown, options?: { bufferSize?: number }): { rootNode: SyntaxNode };
  };
};
const grammars = require("tree-sitter-typescript") as {
  typescript: unknown;
  tsx: unknown;
};

export interface Point {
  row: number;
  column: number;
}

export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: Point;
  endPosition: Point;
  namedChildren: SyntaxNode[];
  parent: SyntaxNode | null;
  childForFieldName(name: string): SyntaxNode | null;
}

const tsParser = new Parser();
tsParser.setLanguage(grammars.typescript);
const tsxParser = new Parser();
tsxParser.setLanguage(grammars.tsx);

export function parseSource(path: string, content: string): SyntaxNode {
  const parser =
    path.endsWith(".tsx") || path.endsWith(".jsx") ? tsxParser : tsParser;
  const bufferSize = Math.max(32 * 1024, content.length * 2);
  return parser.parse(content, undefined, { bufferSize }).rootNode;
}

export function spanOf(node: SyntaxNode) {
  return {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column,
  };
}

export function unquote(text: string): string {
  return text.replace(/^["']|["']$/g, "");
}

export function isUseServerString(node: SyntaxNode): boolean {
  if (node.type !== "string" && node.type !== "string_fragment") {
    return node.type === "expression_statement" &&
      node.namedChildren.some(isUseServerString);
  }
  return unquote(node.text) === "use server";
}

export function fileHasUseServer(root: SyntaxNode): boolean {
  return root.namedChildren.some((child) => {
    if (child.type === "expression_statement") {
      return child.namedChildren.some(isUseServerString);
    }
    return isUseServerString(child);
  });
}

export function functionHasUseServer(fn: SyntaxNode): boolean {
  const body = fn.childForFieldName("body");
  if (!body) {
    return false;
  }
  for (const child of body.namedChildren) {
    if (child.type === "expression_statement" && child.namedChildren.some(isUseServerString)) {
      return true;
    }
    if (isUseServerString(child)) {
      return true;
    }
  }
  return false;
}
