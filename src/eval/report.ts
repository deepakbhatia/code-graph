import { resolve } from "node:path";
import { NextAdapter, collectSourceFiles } from "../adapter-next/index.ts";
import { extractedCalls, naiveCallClaims } from "./naive.ts";
import {
  formatScore,
  missingAmbiguous,
  missingEntries,
  missingUnresolved,
  scoreExtracted,
} from "./score.ts";

const files = await collectSourceFiles(resolve(process.cwd(), "fixtures"));
const batch = new NextAdapter().emit(files);
const ours = scoreExtracted("code-graph", extractedCalls(batch));
const naive = scoreExtracted("name-only", naiveCallClaims(files));

console.log(formatScore(naive));
console.log(formatScore(ours));

const unresolved = missingUnresolved(batch);
const ambiguous = missingAmbiguous(batch);
const entries = missingEntries(batch);
if (unresolved.length || ambiguous.length || entries.length) {
  console.log("code-graph extra misses:");
  if (unresolved.length) {
    console.log("  unresolved:", unresolved);
  }
  if (ambiguous.length) {
    console.log("  ambiguous:", ambiguous);
  }
  if (entries.length) {
    console.log("  entries:", entries);
  }
}

const failed =
  ours.missingRequired.length > 0 ||
  ours.forbiddenHits.length > 0 ||
  unresolved.length > 0 ||
  ambiguous.length > 0 ||
  entries.length > 0;

process.exit(failed ? 1 : 0);
