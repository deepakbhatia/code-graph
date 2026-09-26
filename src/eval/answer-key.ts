/** Known answers for the trap fixtures. Tests score extractors against this list. */

export interface CallAnswer {
  fromFile: string;
  fromName: string;
  toFile: string;
  toName: string;
}

export interface UnresolvedAnswer {
  fromFile: string;
  fromName: string;
  name: string;
}

export interface AmbiguousAnswer {
  fromFile: string;
  fromName: string;
  name: string;
  candidateFiles: string[];
}

export interface EntryAnswer {
  protocol: string;
  qualifier?: string;
  key: string;
}

/** These calls are real. An honest graph must mark them EXTRACTED. */
export const mustBeExtracted: CallAnswer[] = [
  {
    fromFile: "name-collision/app.ts",
    fromName: "run",
    toFile: "name-collision/auth/repo.ts",
    toName: "Repo",
  },
  {
    fromFile: "name-collision/app.ts",
    fromName: "run",
    toFile: "name-collision/auth/repo.ts",
    toName: "save",
  },
  {
    fromFile: "name-collision/app.test.ts",
    fromName: "testRun",
    toFile: "name-collision/app.ts",
    toName: "run",
  },
  {
    fromFile: "local-error/handler.ts",
    fromName: "run",
    toFile: "local-error/handler.ts",
    toName: "error",
  },
  {
    fromFile: "short-names/app.ts",
    fromName: "main",
    toFile: "short-names/util.ts",
    toName: "log",
  },
  {
    fromFile: "app-router/app/api/chat/route.ts",
    fromName: "POST",
    toFile: "app-router/lib/chat.ts",
    toName: "saveChat",
  },
  {
    fromFile: "server-action/app/actions.ts",
    fromName: "saveItem",
    toFile: "server-action/lib/db.ts",
    toName: "persist",
  },
  {
    fromFile: "ambiguous-repo/app.ts",
    fromName: "pick",
    toFile: "name-collision/auth/repo.ts",
    toName: "Repo",
  },
  {
    fromFile: "ambiguous-repo/app.ts",
    fromName: "pick",
    toFile: "name-collision/git/repo.ts",
    toName: "Repo",
  },
];

/** These calls look similar by name but are not facts. EXTRACTED here is a lie. */
export const mustNeverBeExtracted: CallAnswer[] = [
  {
    fromFile: "name-collision/app.ts",
    fromName: "run",
    toFile: "name-collision/git/repo.ts",
    toName: "save",
  },
  {
    fromFile: "name-collision/app.ts",
    fromName: "run",
    toFile: "name-collision/git/repo.ts",
    toName: "Repo",
  },
  {
    fromFile: "name-collision/app.ts",
    fromName: "brokenFind",
    toFile: "app-router/lib/chat.ts",
    toName: "find",
  },
  {
    fromFile: "name-collision/app.ts",
    fromName: "brokenFind",
    toFile: "short-names/db.ts",
    toName: "find",
  },
  {
    fromFile: "name-collision/app.ts",
    fromName: "brokenFind",
    toFile: "short-names/util.ts",
    toName: "find",
  },
  {
    fromFile: "short-names/app.ts",
    fromName: "main",
    toFile: "app-router/lib/chat.ts",
    toName: "find",
  },
  {
    fromFile: "short-names/app.ts",
    fromName: "main",
    toFile: "short-names/db.ts",
    toName: "find",
  },
  {
    fromFile: "short-names/app.ts",
    fromName: "main",
    toFile: "short-names/util.ts",
    toName: "find",
  },
  {
    fromFile: "ambiguous-repo/app.ts",
    fromName: "pick",
    toFile: "name-collision/auth/repo.ts",
    toName: "save",
  },
  {
    fromFile: "ambiguous-repo/app.ts",
    fromName: "pick",
    toFile: "name-collision/git/repo.ts",
    toName: "save",
  },
];

/** No import or local binding. Must stay unresolved, not a fake fact. */
export const mustStayUnresolved: UnresolvedAnswer[] = [
  {
    fromFile: "name-collision/app.ts",
    fromName: "brokenFind",
    name: "find",
  },
  { fromFile: "short-names/app.ts", fromName: "main", name: "find" },
  { fromFile: "local-error/handler.ts", fromName: "run", name: "error" },
];

/** Two real targets, no way to pick one. Must stay AMBIGUOUS. */
export const mustStayAmbiguous: AmbiguousAnswer[] = [
  {
    fromFile: "ambiguous-repo/app.ts",
    fromName: "pick",
    name: "save",
    candidateFiles: [
      "name-collision/auth/repo.ts",
      "name-collision/git/repo.ts",
    ],
  },
];

export const mustEntries: EntryAnswer[] = [
  { protocol: "http", qualifier: "GET", key: "/api/chat" },
  { protocol: "http", qualifier: "POST", key: "/api/chat" },
  { protocol: "server_action", key: "saveItem" },
];
