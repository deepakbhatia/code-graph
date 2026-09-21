import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GraphStore, impact, lookup, route } from "../kernel/index.ts";
import { DEFAULT_DB } from "../indexer.ts";

function dbPath(): string {
  return process.env.CODE_GRAPH_DB ?? DEFAULT_DB;
}

function openStore(): GraphStore | { error: string } {
  const path = dbPath();
  if (path !== ":memory:" && !existsSync(path)) {
    return {
      error: `No graph at ${path}. Run: npx tsx src/cli.ts index <repo> --db ${path}`,
    };
  }
  return GraphStore.open(path);
}

function asText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({
  name: "code-graph",
  version: "0.1.0",
});

server.registerTool(
  "lookup",
  {
    description:
      "Find graph nodes by name, file, or id. Use this before grepping for a symbol.",
    inputSchema: {
      name: z.string().optional().describe("Exact symbol or entry name"),
      file: z.string().optional().describe("Repo-relative file path"),
      id: z.string().optional().describe("Stable node id"),
    },
  },
  async (args) => {
    const store = openStore();
    if ("error" in store) {
      return asText(store);
    }
    try {
      return asText(lookup(store, args));
    } finally {
      store.close();
    }
  },
);

server.registerTool(
  "impact",
  {
    description:
      "Callers, callees, and test files that import a symbol's module. Unresolved calls stay unresolved.",
    inputSchema: {
      name: z.string().optional(),
      file: z.string().optional(),
      id: z.string().optional(),
    },
  },
  async (args) => {
    const store = openStore();
    if ("error" in store) {
      return asText(store);
    }
    try {
      return asText(impact(store, args));
    } finally {
      store.close();
    }
  },
);

server.registerTool(
  "route",
  {
    description:
      "Find an Entry node by protocol/qualifier/key (for HTTP: method + path) and its import-gated callees.",
    inputSchema: {
      protocol: z.string().optional().describe("http, server_action, …"),
      qualifier: z.string().optional().describe("HTTP method, if any"),
      method: z.string().optional().describe("Alias for qualifier"),
      key: z.string().optional().describe("Entry key such as /api/chat"),
      path: z.string().optional().describe("Alias for key"),
    },
  },
  async (args) => {
    const store = openStore();
    if ("error" in store) {
      return asText(store);
    }
    try {
      return asText(
        route(store, {
          protocol: args.protocol ?? "http",
          qualifier: args.qualifier ?? args.method,
          key: args.key ?? args.path,
        }),
      );
    } finally {
      store.close();
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
