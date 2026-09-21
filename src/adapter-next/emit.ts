import {
  EdgeKind,
  FileRole,
  Honesty,
  ProofKind,
  SymbolKind,
  classifyResolution,
  entryNode,
  fileNode,
  graphEdge,
  symbolNode,
  type BindingProof,
  type EntryNode,
  type GraphAdapter,
  type GraphBatch,
  type GraphEdge,
  type SourceFile,
  type SymbolNode,
} from "../kernel/index.ts";
import {
  fileHasUseServer,
  functionHasUseServer,
  parseSource,
  spanOf,
  unquote,
  type SyntaxNode,
} from "./parse.ts";
import {
  HTTP_METHODS,
  fileRole,
  httpRouteKey,
  languageFor,
  resolveSpecifier,
} from "./paths.ts";

interface ImportBinding {
  local: string;
  imported: string;
  specifier: string;
  namespace: boolean;
  proof: BindingProof;
}

interface InstanceBinding {
  classIds: string[];
  proof: BindingProof;
}

interface FileFacts {
  source: SourceFile;
  root: SyntaxNode;
  fileUseServer: boolean;
  symbols: SymbolNode[];
  entries: EntryNode[];
  imports: ImportBinding[];
  exports: Map<string, string>;
  classMethods: Map<string, Map<string, string>>;
  functions: Map<string, SymbolNode>;
  instances: Map<string, InstanceBinding>;
  calls: CallSite[];
}

interface CallSite {
  srcId: string;
  node: SyntaxNode;
  proof: BindingProof;
}

export class NextAdapter implements GraphAdapter {
  readonly id = "next-typescript";

  emit(files: readonly SourceFile[]): GraphBatch {
    const fileSet = new Set(files.map((file) => file.path));
    const facts = files.map((file) => collectFile(file));
    const byPath = new Map(facts.map((fact) => [fact.source.path, fact]));

    const batch: GraphBatch = {
      files: files.map((file) =>
        fileNode({
          path: file.path,
          contentHash: file.contentHash,
          language: languageFor(file.path),
          role: fileRole(file.path) === "test" ? FileRole.Test : FileRole.Source,
        }),
      ),
      nodes: facts.flatMap((fact) => [...fact.symbols, ...fact.entries]),
      edges: [],
    };

    for (const fact of facts) {
      for (const imported of fact.imports) {
        const destPath = resolveSpecifier(fact.source.path, imported.specifier, fileSet);
        const destFile = destPath ? byPath.get(destPath) : undefined;
        if (!destFile) {
          batch.edges.push(
            graphEdge({
              kind: EdgeKind.Imports,
              srcId: `file:${fact.source.path}`,
              honesty: Honesty.Unresolved,
              proof: imported.proof,
              unresolvedName: imported.specifier,
            }),
          );
          continue;
        }
        batch.edges.push(
          graphEdge({
            kind: EdgeKind.Imports,
            srcId: `file:${fact.source.path}`,
            dstId: `file:${destFile.source.path}`,
            honesty: Honesty.Extracted,
            proof: imported.proof,
          }),
        );
      }
    }

    for (const fact of facts) {
      for (const call of fact.calls) {
        batch.edges.push(resolveCall(call, fact, byPath, fileSet));
      }
      for (const entry of fact.entries) {
        const handlerName = entry.protocol === "http" ? entry.qualifier : entry.key;
        const handler = handlerName ? fact.exports.get(handlerName) : undefined;
        if (!handler) {
          continue;
        }
        batch.edges.push(
          graphEdge({
            kind: EdgeKind.Handles,
            srcId: entry.id,
            dstId: handler,
            honesty: Honesty.Extracted,
            proof: {
              kind: ProofKind.EntryBinding,
              span: entry.span ?? spanOf(fact.root),
              evidence: `${entry.protocol}:${entry.qualifier ?? ""}:${entry.key}`,
            },
          }),
        );
      }
    }

    return batch;
  }
}

function collectFile(source: SourceFile): FileFacts {
  const root = parseSource(source.path, source.content);
  const facts: FileFacts = {
    source,
    root,
    fileUseServer: fileHasUseServer(root),
    symbols: [],
    entries: [],
    imports: [],
    exports: new Map(),
    classMethods: new Map(),
    functions: new Map(),
    instances: new Map(),
    calls: [],
  };
  visit(root, facts, { fnId: null, classId: null });
  return facts;
}

interface VisitEnv {
  fnId: string | null;
  classId: string | null;
}

function visit(node: SyntaxNode, facts: FileFacts, env: VisitEnv): void {
  switch (node.type) {
    case "import_statement":
      collectImport(node, facts);
      return;
    case "lexical_declaration":
    case "variable_declaration":
      collectLexical(node, facts, env);
      return;
    case "export_statement":
      collectExport(node, facts, env);
      return;
    case "function_declaration":
    case "generator_function_declaration":
      collectFunction(node, facts, env);
      return;
    case "class_declaration":
      collectClass(node, facts, env);
      return;
    case "method_definition":
      collectMethod(node, facts, env);
      return;
    case "call_expression":
      collectCall(node, facts, env);
      break;
    case "new_expression":
      collectCall(node, facts, env);
      break;
    default:
      break;
  }

  for (const child of node.namedChildren) {
    visit(child, facts, env);
  }
}

function collectImport(node: SyntaxNode, facts: FileFacts): void {
  const source = node.childForFieldName("source");
  if (!source) {
    return;
  }
  const specifier = unquote(source.text);
  const proof: BindingProof = {
    kind: ProofKind.Import,
    span: spanOf(node),
    evidence: specifier,
  };
  const clause = node.namedChildren.find((child) => child.type === "import_clause");
  if (!clause) {
    facts.imports.push({
      local: specifier,
      imported: "*",
      specifier,
      namespace: false,
      proof,
    });
    return;
  }
  for (const part of clause.namedChildren) {
    if (part.type === "identifier") {
      facts.imports.push({
        local: part.text,
        imported: "default",
        specifier,
        namespace: false,
        proof,
      });
    }
    if (part.type === "namespace_import") {
      const ident = part.namedChildren.find((child) => child.type === "identifier");
      if (ident) {
        facts.imports.push({
          local: ident.text,
          imported: "*",
          specifier,
          namespace: true,
          proof,
        });
      }
    }
    if (part.type === "named_imports") {
      for (const spec of part.namedChildren) {
        if (spec.type !== "import_specifier") {
          continue;
        }
        const name = spec.childForFieldName("name") ?? spec.namedChildren[0];
        const alias = spec.childForFieldName("alias");
        if (!name) {
          continue;
        }
        facts.imports.push({
          local: (alias ?? name).text,
          imported: name.text,
          specifier,
          namespace: false,
          proof,
        });
      }
    }
  }
}

function collectFunction(
  node: SyntaxNode,
  facts: FileFacts,
  env: VisitEnv,
): void {
  const nameNode = node.childForFieldName("name");
  const name = nameNode?.text ?? "default";
  const symbol = symbolNode({
    file: facts.source.path,
    name,
    symbolKind: SymbolKind.Function,
    span: spanOf(nameNode ?? node),
  });
  facts.symbols.push(symbol);
  facts.functions.set(name, symbol);
  if (isExported(node)) {
    facts.exports.set(name, symbol.id);
    maybeEntry(facts, symbol, node);
  }
  const body = node.childForFieldName("body");
  if (body) {
    visit(body, facts, { ...env, fnId: symbol.id });
  }
}

function collectClass(node: SyntaxNode, facts: FileFacts, _env: VisitEnv): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) {
    return;
  }
  const symbol = symbolNode({
    file: facts.source.path,
    name: nameNode.text,
    symbolKind: SymbolKind.Class,
    span: spanOf(nameNode),
  });
  facts.symbols.push(symbol);
  facts.functions.set(nameNode.text, symbol);
  facts.classMethods.set(symbol.id, new Map());
  if (isExported(node)) {
    facts.exports.set(nameNode.text, symbol.id);
  }
  const body = node.childForFieldName("body");
  if (body) {
    for (const child of body.namedChildren) {
      visit(child, facts, {
        fnId: symbol.id,
        classId: symbol.id,
      });
    }
  }
}

function collectMethod(node: SyntaxNode, facts: FileFacts, env: VisitEnv): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode || !env.classId) {
    return;
  }
  const symbol = symbolNode({
    file: facts.source.path,
    name: nameNode.text,
    symbolKind: nameNode.text === "constructor" ? SymbolKind.Function : SymbolKind.Method,
    span: spanOf(nameNode),
  });
  facts.symbols.push(symbol);
  facts.classMethods.get(env.classId)?.set(nameNode.text, symbol.id);
  const body = node.childForFieldName("body");
  if (body) {
    visit(body, facts, { ...env, fnId: symbol.id });
  }
}

function collectLexical(node: SyntaxNode, facts: FileFacts, env: VisitEnv): void {
  for (const declarator of node.namedChildren) {
    if (declarator.type !== "variable_declarator") {
      continue;
    }
    const nameNode = declarator.childForFieldName("name");
    const value = declarator.childForFieldName("value");
    if (!nameNode) {
      continue;
    }
    if (value && (value.type === "arrow_function" || value.type === "function_expression" || value.type === "generator_function")) {
      const symbol = symbolNode({
        file: facts.source.path,
        name: nameNode.text,
        symbolKind: SymbolKind.Function,
        span: spanOf(nameNode),
      });
      facts.symbols.push(symbol);
      facts.functions.set(nameNode.text, symbol);
      if (isExported(node)) {
        facts.exports.set(nameNode.text, symbol.id);
        maybeEntry(facts, symbol, value);
      }
      const body = value.childForFieldName("body");
      if (body) {
        visit(body, facts, { ...env, fnId: symbol.id });
      }
      continue;
    }
    if (value) {
      const classes = collectNewClasses(value);
      if (classes.length > 0) {
        facts.instances.set(`${env.fnId ?? "module"}:${nameNode.text}`, {
          classIds: classes,
          proof: {
            kind: ProofKind.Local,
            span: spanOf(declarator),
            evidence: nameNode.text,
          },
        });
      }
      visit(value, facts, env);
    }
  }
}

function collectExport(node: SyntaxNode, facts: FileFacts, env: VisitEnv): void {
  const declaration = node.childForFieldName("declaration");
  if (declaration) {
    visit(declaration, facts, env);
    return;
  }
  const clause = node.namedChildren.find((child) => child.type === "export_clause");
  if (!clause) {
    return;
  }
  for (const spec of clause.namedChildren) {
    if (spec.type !== "export_specifier") {
      continue;
    }
    const name = spec.childForFieldName("name") ?? spec.namedChildren[0];
    const alias = spec.childForFieldName("alias");
    if (!name) {
      continue;
    }
    const local = facts.functions.get(name.text);
    if (local) {
      facts.exports.set((alias ?? name).text, local.id);
    }
  }
}

function collectCall(node: SyntaxNode, facts: FileFacts, env: VisitEnv): void {
  if (!env.fnId) {
    return;
  }
  facts.calls.push({
    srcId: env.fnId,
    node,
    proof: {
      kind: ProofKind.Local,
      span: spanOf(node),
      evidence: node.text.slice(0, 80),
    },
  });
}

function collectNewClasses(node: SyntaxNode): string[] {
  const found: string[] = [];
  walkNew(node, found);
  return found;
}

function walkNew(node: SyntaxNode, found: string[]): void {
  if (node.type === "new_expression") {
    const ctor = node.childForFieldName("constructor") ?? node.namedChildren[0];
    if (ctor?.type === "identifier") {
      found.push(ctor.text);
    }
  }
  for (const child of node.namedChildren) {
    walkNew(child, found);
  }
}

function maybeEntry(facts: FileFacts, symbol: SymbolNode, fnNode: SyntaxNode): void {
  const routeKey = httpRouteKey(facts.source.path);
  if (routeKey && symbol.name && HTTP_METHODS.has(symbol.name)) {
    facts.entries.push(
      entryNode({
        file: facts.source.path,
        protocol: "http",
        qualifier: symbol.name,
        key: routeKey,
        span: symbol.span,
      }),
    );
  }
  if (facts.fileUseServer || functionHasUseServer(fnNode)) {
    facts.entries.push(
      entryNode({
        file: facts.source.path,
        protocol: "server_action",
        key: symbol.name,
        span: symbol.span,
      }),
    );
  }
}

function isExported(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "export_statement") {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function resolveCall(
  call: CallSite,
  fact: FileFacts,
  byPath: Map<string, FileFacts>,
  fileSet: ReadonlySet<string>,
): GraphEdge {
  const callee = call.node.childForFieldName("function") ??
    call.node.childForFieldName("constructor") ??
    call.node.namedChildren[0];
  if (!callee) {
    return unresolved(call, "call");
  }

  if (callee.type === "identifier") {
    return resolveIdentifier(callee.text, call, fact, byPath, fileSet);
  }

  if (callee.type === "member_expression" || callee.type === "optional_member_expression") {
    const object = callee.childForFieldName("object");
    const property = callee.childForFieldName("property");
    if (!object || !property) {
      return unresolved(call, callee.text);
    }
    if (object.type === "this" && fact.classMethods.size) {
      const classId = classIdForFunction(call.srcId, fact);
      const methodId = classId
        ? fact.classMethods.get(classId)?.get(property.text)
        : undefined;
      const decision = classifyResolution({
        candidateIds: methodId ? [methodId] : [],
        proof: methodId
          ? { kind: ProofKind.Local, span: spanOf(call.node), evidence: `this.${property.text}` }
          : null,
      });
      return graphEdge({
        kind: EdgeKind.Calls,
        srcId: call.srcId,
        unresolvedName: property.text,
        proof: decision.honesty === Honesty.Extracted
          ? { kind: ProofKind.Local, span: spanOf(call.node), evidence: `this.${property.text}` }
          : null,
        ...decision,
      });
    }
    if (object.type === "identifier") {
      const ns = fact.imports.find((item) => item.local === object.text && item.namespace);
      if (ns) {
        return resolveImportedName(property.text, ns, call, fact, byPath, fileSet);
      }
      const imported = fact.imports.find((item) => item.local === object.text && !item.namespace);
      if (imported) {
        const dest = resolveImportedName(imported.imported === "default" ? "default" : imported.imported, imported, call, fact, byPath, fileSet);
        if (dest.honesty === Honesty.Extracted && dest.dstId) {
          const destFact = byPath.get(resolveSpecifier(fact.source.path, imported.specifier, fileSet) ?? "");
          const methodId = destFact
            ? methodOnClass(dest.dstId, property.text, destFact)
            : undefined;
          const proof = {
            kind: ProofKind.Import,
            span: spanOf(call.node),
            evidence: `${imported.local}.${property.text}`,
          } satisfies BindingProof;
          const decision = classifyResolution({
            candidateIds: methodId ? [methodId] : [],
            proof: methodId ? proof : null,
          });
          return graphEdge({
            kind: EdgeKind.Calls,
            srcId: call.srcId,
            unresolvedName: property.text,
            proof: decision.honesty === Honesty.Extracted ? proof : null,
            ...decision,
          });
        }
      }
      const instance = fact.instances.get(`${call.srcId}:${object.text}`);
      if (instance) {
        const classIds = instance.classIds
          .map((name) => resolveClassId(name, fact, byPath, fileSet))
          .filter((id): id is string => id !== null);
        const methodIds = [...new Set(
          classIds.flatMap((classId) => {
            const owner = [...byPath.values()].find((item) =>
              item.symbols.some((symbol) => symbol.id === classId),
            );
            const methodId = owner ? owner.classMethods.get(classId)?.get(property.text) : undefined;
            return methodId ? [methodId] : [];
          }),
        )];
        const proof = methodIds.length === 1
          ? {
              kind: ProofKind.Local,
              span: spanOf(call.node),
              evidence: `${object.text}.${property.text}`,
            } satisfies BindingProof
          : null;
        const decision = classifyResolution({ candidateIds: methodIds, proof });
        return graphEdge({
          kind: EdgeKind.Calls,
          srcId: call.srcId,
          unresolvedName: property.text,
          proof: decision.honesty === Honesty.Extracted ? proof : null,
          candidates: decision.candidates,
          honesty: decision.honesty,
          dstId: decision.dstId,
        });
      }
    }
    return unresolved(call, property.text);
  }

  return unresolved(call, callee.text);
}

function resolveIdentifier(
  name: string,
  call: CallSite,
  fact: FileFacts,
  byPath: Map<string, FileFacts>,
  fileSet: ReadonlySet<string>,
): GraphEdge {
  const local = fact.functions.get(name);
  if (local) {
    const proof = {
      kind: ProofKind.Local,
      span: spanOf(call.node),
      evidence: name,
    } satisfies BindingProof;
    const decision = classifyResolution({ candidateIds: [local.id], proof });
    return graphEdge({
      kind: EdgeKind.Calls,
      srcId: call.srcId,
      proof,
      ...decision,
    });
  }
  const imported = fact.imports.find((item) => item.local === name);
  if (imported) {
    return resolveImportedName(imported.imported, imported, call, fact, byPath, fileSet);
  }
  return unresolved(call, name);
}

function resolveImportedName(
  exportedName: string,
  imported: ImportBinding,
  call: CallSite,
  fact: FileFacts,
  byPath: Map<string, FileFacts>,
  fileSet: ReadonlySet<string>,
): GraphEdge {
  const destPath = resolveSpecifier(fact.source.path, imported.specifier, fileSet);
  const dest = destPath ? byPath.get(destPath) : undefined;
  const dstId = dest?.exports.get(exportedName === "*" ? exportedName : exportedName);
  const proof = {
    kind: ProofKind.Import,
    span: spanOf(call.node),
    evidence: `${imported.specifier}:${exportedName}`,
  } satisfies BindingProof;
  const decision = classifyResolution({
    candidateIds: dstId ? [dstId] : [],
    proof: dstId ? proof : null,
  });
  return graphEdge({
    kind: EdgeKind.Calls,
    srcId: call.srcId,
    unresolvedName: exportedName,
    proof: decision.honesty === Honesty.Extracted ? proof : null,
    ...decision,
  });
}

function resolveClassId(
  name: string,
  fact: FileFacts,
  byPath: Map<string, FileFacts>,
  fileSet: ReadonlySet<string>,
): string | null {
  const local = fact.functions.get(name);
  if (local?.symbolKind === SymbolKind.Class) {
    return local.id;
  }
  const imported = fact.imports.find((item) => item.local === name);
  if (!imported) {
    return null;
  }
  const destPath = resolveSpecifier(fact.source.path, imported.specifier, fileSet);
  const dest = destPath ? byPath.get(destPath) : undefined;
  return dest?.exports.get(imported.imported) ?? null;
}

function methodOnClass(classId: string, method: string, fact: FileFacts): string | undefined {
  return fact.classMethods.get(classId)?.get(method);
}

function classIdForFunction(fnId: string, fact: FileFacts): string | null {
  for (const [classId, methods] of fact.classMethods) {
    if ([...methods.values()].includes(fnId) || classId === fnId) {
      return classId;
    }
  }
  return null;
}

function unresolved(call: CallSite, name: string): GraphEdge {
  return graphEdge({
    kind: EdgeKind.Calls,
    srcId: call.srcId,
    honesty: Honesty.Unresolved,
    unresolvedName: name,
  });
}
