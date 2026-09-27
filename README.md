# code-graph

A local map of a TypeScript / Next.js repo: files, functions, who calls whom, and HTTP routes.

You index once. Then you ask:

- **lookup** — find a symbol
- **impact** — who calls this, what it calls, which tests import it
- **route** — what handles `POST /api/chat`, and the functions that call chain reaches


| Question                                     | grep                                       | This                                            |
| -------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| What breaks if I change this function?       | A list of the same word                    | The functions that call it, and what those call |
| What does `POST /api/chat` run?              | You hunt for the file, then follow imports | The handler and the path that follows           |
| Two things named `find` — which one is this? | They look the same                         | It follows the import, so they stay separate    |
| Are there tests for this change?             | You guess from file names                  | Tests that import this module                   |


## Setup

```bash
npm install
```

## Index a repo

```bash
npx tsx src/cli.ts index path/to/repo
```

That writes `.code-graph/graph.sqlite`.

Examples:

```bash
npx tsx src/cli.ts index fixtures
./scripts/fetch-corpus.sh
npx tsx src/cli.ts index corpus/ai-chatbot
```

Re-run index after the code changes.

## Query

```bash
npx tsx src/cli.ts lookup --name getChatById
npx tsx src/cli.ts impact --name getChatById
npx tsx src/cli.ts route --method POST --path /api/chat
```

## Cursor

1. Index a repo (above).
2. Add an MCP server that runs `npx tsx src/mcp/server.ts`.
3. In a new chat, ask a structural question, for example:

> What handles POST /api/chat, and which functions does that handler call?

The tools are `lookup`, `impact`, and `route`.

## Tests

```bash
npm test
npm run eval:fixtures
```

`eval:fixtures` scores the graph on small trap programs in `fixtures/`.