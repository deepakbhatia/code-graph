import { dirname, join, normalize, posix, relative, sep } from "node:path";

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];
const INDEX_FILES = [
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

export const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

export const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

export function isSourceFile(path: string): boolean {
  const posixPath = toPosix(path);
  if (posixPath.endsWith(".d.ts") || posixPath.endsWith(".d.tsx")) {
    return false;
  }
  const dot = posixPath.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(posixPath.slice(dot));
}

export function isSkippedDir(name: string): boolean {
  return (
    name === "node_modules" ||
    name === ".git" ||
    name === "dist" ||
    name === ".next" ||
    name === "coverage" ||
    name === ".code-graph"
  );
}

export function fileRole(path: string): "source" | "test" {
  const posixPath = toPosix(path);
  if (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(posixPath) ||
    posixPath.includes("/__tests__/")
  ) {
    return "test";
  }
  return "source";
}

export function languageFor(path: string): string {
  return toPosix(path).endsWith("x") ? "tsx" : "typescript";
}

/**
 * App Router HTTP key from a route file. Route groups like (chat) are dropped.
 * Adapter-owned — the kernel never sees this mapping.
 */
export function httpRouteKey(filePath: string): string | null {
  const posixPath = toPosix(filePath);
  const match = posixPath.match(
    /(?:^|\/)(?:src\/)?app\/(.+)\/route\.[cm]?[jt]sx?$/,
  );
  if (!match?.[1]) {
    return null;
  }
  const parts = match[1]
    .split("/")
    .filter((part) => part.length > 0 && !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
}

export function isRouteFile(filePath: string): boolean {
  return httpRouteKey(filePath) !== null;
}

export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | null {
  const cleaned = specifier.replace(/^["']|["']$/g, "");
  if (cleaned.startsWith("@/")) {
    return existingFile(cleaned.slice(2), files);
  }
  if (cleaned.startsWith(".") || cleaned.startsWith("/")) {
    const fromDir = dirname(fromFile);
    const base = toPosix(normalize(join(fromDir, cleaned)));
    return existingFile(base, files);
  }
  return null;
}

function existingFile(base: string, files: ReadonlySet<string>): string | null {
  const normalized = toPosix(normalize(base)).replace(/^\.\//, "");
  for (const ext of EXTENSIONS) {
    if (files.has(normalized + ext)) {
      return normalized + ext;
    }
  }
  for (const index of INDEX_FILES) {
    if (files.has(normalized + index)) {
      return normalized + index;
    }
  }
  return null;
}

export function relativeToRoot(root: string, absolute: string): string {
  return toPosix(relative(root, absolute));
}
