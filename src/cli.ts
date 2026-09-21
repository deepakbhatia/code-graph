import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_DB, indexDirectory } from "./indexer.ts";
import { GraphStore, impact, lookup, route } from "./kernel/index.ts";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function dbPath(): string {
  return arg("--db") ?? process.env.CODE_GRAPH_DB ?? DEFAULT_DB;
}

function openDb(): GraphStore {
  return GraphStore.open(dbPath());
}

const command = process.argv[2];

if (command === "index") {
  const root = resolve(process.argv[3] ?? ".");
  const dest = dbPath();
  mkdirSync(dirname(dest), { recursive: true });
  const store = await indexDirectory(root, dest);
  const nodes = store.listNodes({});
  const entries = nodes.filter((node) => node.kind === "entry");
  console.log(
    JSON.stringify(
      {
        db: dest,
        files: store.listNodes({ kind: "file" }).length,
        symbols: store.listNodes({ kind: "symbol" }).length,
        entries: entries.length,
      },
      null,
      2,
    ),
  );
  store.close();
} else if (command === "lookup") {
  const store = openDb();
  console.log(
    JSON.stringify(
      lookup(store, {
        name: arg("--name"),
        file: arg("--file"),
        id: arg("--id"),
      }),
      null,
      2,
    ),
  );
  store.close();
} else if (command === "impact") {
  const store = openDb();
  console.log(
    JSON.stringify(
      impact(store, {
        name: arg("--name"),
        file: arg("--file"),
        id: arg("--id"),
      }),
      null,
      2,
    ),
  );
  store.close();
} else if (command === "route") {
  const store = openDb();
  console.log(
    JSON.stringify(
      route(store, {
        protocol: arg("--protocol") ?? "http",
        qualifier: arg("--method") ?? arg("--qualifier"),
        key: arg("--path") ?? arg("--key"),
      }),
      null,
      2,
    ),
  );
  store.close();
} else {
  console.error("usage: code-graph <index|lookup|impact|route> [options]");
  process.exit(1);
}
