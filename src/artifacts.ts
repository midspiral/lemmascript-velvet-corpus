import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { COMPONENT_ROLES } from "./types.js";
import type {
  CaseMetadata,
  ComponentMetadata,
  CorpusMetadata,
  FileFacts,
  PathFacts,
  SourceMetadata,
  SupportMetadata,
} from "./types.js";
import { GENERATED_MARKER, facts, listFilesRecursive, toPosix } from "./files.js";
import { parseLeanHeader } from "./lean-header.js";

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where} must be a non-empty string`);
  return value;
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null) return null;
  return string(value, where);
}

function nullableBoolean(value: unknown, where: string): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  throw new Error(`${where} must be boolean or null`);
}

function nonnegativeInteger(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${where} must be a non-negative integer`);
  }
  return value;
}

function safeArtifactPath(value: unknown, where: string): string {
  const result = string(value, where);
  if (
    path.posix.isAbsolute(result) || path.posix.normalize(result) !== result || result.startsWith("../") ||
    result === ".." || result === "." || result.includes("\\") || /[\0\r\n]/.test(result)
  ) {
    throw new Error(`${where} must be a safe relative path: ${result}`);
  }
  return result;
}

function parseFacts(value: unknown, where: string): FileFacts {
  const raw = object(value, where);
  const sha256 = string(raw.sha256, `${where}.sha256`);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${where}.sha256 is invalid`);
  return {
    sha256,
    bytes: nonnegativeInteger(raw.bytes, `${where}.bytes`),
    lines: nonnegativeInteger(raw.lines, `${where}.lines`),
  };
}

function parsePathFacts(value: unknown, where: string): PathFacts {
  const raw = object(value, where);
  return { path: safeArtifactPath(raw.path, `${where}.path`), ...parseFacts(raw, where) };
}

function parseSource(value: unknown, where: string): SourceMetadata {
  const raw = object(value, where);
  const license = object(raw.license, `${where}.license`);
  return {
    id: string(raw.id, `${where}.id`),
    repository: string(raw.repository, `${where}.repository`),
    checkout: safeArtifactPath(raw.checkout, `${where}.checkout`),
    expectedBranch: string(raw.expectedBranch, `${where}.expectedBranch`),
    observedBranch: nullableString(raw.observedBranch, `${where}.observedBranch`),
    head: nullableString(raw.head, `${where}.head`),
    relevantDirty: nullableBoolean(raw.relevantDirty, `${where}.relevantDirty`),
    branchMatches: nullableBoolean(raw.branchMatches, `${where}.branchMatches`),
    license: {
      spdx: string(license.spdx, `${where}.license.spdx`),
      source: parsePathFacts(license.source, `${where}.license.source`),
      output: parsePathFacts(license.output, `${where}.license.output`),
    },
  };
}

function parseSupport(value: unknown, where: string): SupportMetadata {
  const raw = object(value, where);
  return {
    sourceId: string(raw.sourceId, `${where}.sourceId`),
    source: parsePathFacts(raw.source, `${where}.source`),
    output: parsePathFacts(raw.output, `${where}.output`),
  };
}

function parseComponent(value: unknown, where: string): ComponentMetadata {
  const raw = object(value, where);
  const role = string(raw.role, `${where}.role`);
  if (!(COMPONENT_ROLES as readonly string[]).includes(role)) throw new Error(`${where}.role is invalid: ${role}`);
  return { role: role as ComponentMetadata["role"], source: parsePathFacts(raw.source, `${where}.source`) };
}

function parseCase(value: unknown, where: string): CaseMetadata {
  const raw = object(value, where);
  const kind = string(raw.kind, `${where}.kind`);
  if (!(["proof", "properties", "elaboration"] as const).includes(kind as CaseMetadata["kind"])) {
    throw new Error(`${where}.kind is invalid: ${kind}`);
  }
  return {
    id: string(raw.id, `${where}.id`),
    unit: string(raw.unit, `${where}.unit`),
    group: string(raw.group, `${where}.group`),
    sourceId: string(raw.sourceId, `${where}.sourceId`),
    module: string(raw.module, `${where}.module`),
    kind: kind as CaseMetadata["kind"],
    imports: array(raw.imports, `${where}.imports`).map((entry, index) => string(entry, `${where}.imports[${index}]`)),
    components: array(raw.components, `${where}.components`).map((entry, index) => parseComponent(entry, `${where}.components[${index}]`)),
    proveCorrectCommands: nonnegativeInteger(raw.proveCorrectCommands, `${where}.proveCorrectCommands`),
    output: parsePathFacts(raw.output, `${where}.output`),
  };
}

export function parseMetadata(value: unknown): CorpusMetadata {
  const raw = object(value, "metadata");
  if (raw.schemaVersion !== 1) throw new Error("metadata.schemaVersion must be 1");
  const countRaw = object(raw.counts, "metadata.counts");
  return {
    schemaVersion: 1,
    generator: string(raw.generator, "metadata.generator"),
    leanToolchain: string(raw.leanToolchain, "metadata.leanToolchain"),
    counts: {
      sources: nonnegativeInteger(countRaw.sources, "metadata.counts.sources"),
      supportFiles: nonnegativeInteger(countRaw.supportFiles, "metadata.counts.supportFiles"),
      cases: nonnegativeInteger(countRaw.cases, "metadata.counts.cases"),
      components: nonnegativeInteger(countRaw.components, "metadata.counts.components"),
      proofCases: nonnegativeInteger(countRaw.proofCases, "metadata.counts.proofCases"),
      propertyCases: nonnegativeInteger(countRaw.propertyCases, "metadata.counts.propertyCases"),
      elaborationCases: nonnegativeInteger(countRaw.elaborationCases, "metadata.counts.elaborationCases"),
      proveCorrectCommands: nonnegativeInteger(countRaw.proveCorrectCommands, "metadata.counts.proveCorrectCommands"),
    },
    sources: array(raw.sources, "metadata.sources").map((entry, index) => parseSource(entry, `metadata.sources[${index}]`)),
    support: array(raw.support, "metadata.support").map((entry, index) => parseSupport(entry, `metadata.support[${index}]`)),
    cases: array(raw.cases, "metadata.cases").map((entry, index) => parseCase(entry, `metadata.cases[${index}]`)),
    attribution: parsePathFacts(raw.attribution, "metadata.attribution"),
  };
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function sameFacts(left: FileFacts, right: FileFacts): boolean {
  return left.sha256 === right.sha256 && left.bytes === right.bytes && left.lines === right.lines;
}

async function verifyFile(root: string, recorded: PathFacts): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await readFile(path.join(root, recorded.path)));
  } catch (error) {
    throw new Error(`missing artifact ${recorded.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const actual = facts(bytes);
  if (!sameFacts(actual, recorded)) {
    throw new Error(`artifact facts do not match ${recorded.path}`);
  }
  return bytes;
}

function renderSegment(segment: string): string {
  return /^[A-Za-z_][A-Za-z0-9_']*$/.test(segment) ? segment : `«${segment}»`;
}

function expectedModule(outputPath: string): string {
  const match = /^Corpus\/([^/]+)\/([^/]+)\.lean$/.exec(outputPath);
  if (!match) throw new Error(`case output path has the wrong shape: ${outputPath}`);
  return `Corpus.${renderSegment(match[1])}.${renderSegment(match[2])}`;
}

export function representedArtifactPaths(value: unknown): Set<string> {
  const metadata = parseMetadata(value);
  return new Set([
    "metadata.json",
    metadata.attribution.path,
    ...metadata.sources.map((source) => source.license.output.path),
    ...metadata.support.map((entry) => entry.output.path),
    ...metadata.cases.map((entry) => entry.output.path),
  ]);
}

async function actualManagedPaths(root: string): Promise<Set<string>> {
  const paths = new Set<string>(["metadata.json"]);
  for (const directory of ["Corpus", "LemmaScript", "LICENSES"]) {
    for (const child of await listFilesRecursive(path.join(root, directory))) {
      paths.add(toPosix(path.join(directory, child)));
    }
  }
  const supportRoot = await stat(path.join(root, "LemmaScript.lean")).catch(() => null);
  if (supportRoot?.isFile()) paths.add("LemmaScript.lean");
  return paths;
}

export async function validateArtifactsAt(root: string): Promise<CorpusMetadata> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"));
  } catch (error) {
    throw new Error(`cannot read metadata.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const metadata = parseMetadata(parsed);
  assertUnique(metadata.sources.map((source) => source.id), "source id");
  assertUnique(metadata.sources.map((source) => source.checkout.toLowerCase()), "source checkout");
  assertUnique(metadata.cases.map((entry) => entry.id), "case id");
  assertUnique(metadata.cases.map((entry) => entry.module.toLowerCase()), "case module");
  assertUnique(metadata.cases.map((entry) => entry.output.path.toLowerCase()), "case output");
  assertUnique(metadata.support.map((entry) => entry.output.path.toLowerCase()), "support output");
  assertUnique([
    metadata.attribution.path.toLowerCase(),
    ...metadata.sources.map((source) => source.license.output.path.toLowerCase()),
    ...metadata.support.map((entry) => entry.output.path.toLowerCase()),
    ...metadata.cases.map((entry) => entry.output.path.toLowerCase()),
  ], "managed output");

  const sourceIds = new Set(metadata.sources.map((source) => source.id));
  for (const source of metadata.sources) {
    if (!metadata.support.some((entry) => entry.sourceId === source.id) &&
        !metadata.cases.some((entry) => entry.sourceId === source.id)) {
      throw new Error(`${source.id}: source is not represented by support or cases`);
    }
  }
  for (const source of metadata.sources) {
    if (source.license.output.path !== `LICENSES/${source.id}.txt`) {
      throw new Error(`${source.id}: unexpected license output ${source.license.output.path}`);
    }
    if (!sameFacts(source.license.source, source.license.output)) {
      throw new Error(`${source.id}: copied license facts differ from source facts`);
    }
    await verifyFile(root, source.license.output);
    const expectedMatch = source.head === null && source.observedBranch === null
      ? null
      : source.observedBranch === source.expectedBranch;
    if (source.branchMatches !== expectedMatch) throw new Error(`${source.id}: branchMatches is inconsistent`);
  }

  const consumedPaths = new Set<string>();
  for (const entry of metadata.support) {
    if (!sourceIds.has(entry.sourceId)) throw new Error(`support file names unknown source ${entry.sourceId}`);
    if (!(entry.output.path === "LemmaScript.lean" || entry.output.path.startsWith("LemmaScript/"))) {
      throw new Error(`support output is outside the support tree: ${entry.output.path}`);
    }
    if (!sameFacts(entry.source, entry.output)) throw new Error(`support copy facts differ: ${entry.output.path}`);
    const consumedKey = `${entry.sourceId}/${entry.source.path}`;
    if (consumedPaths.has(consumedKey)) throw new Error(`source file is represented more than once: ${consumedKey}`);
    consumedPaths.add(consumedKey);
    await verifyFile(root, entry.output);
  }

  const roleIndex = new Map(COMPONENT_ROLES.map((role, index) => [role, index]));
  for (const entry of metadata.cases) {
    if (!sourceIds.has(entry.sourceId)) throw new Error(`${entry.id}: unknown source ${entry.sourceId}`);
    if (entry.id !== `${entry.group}/${entry.unit}`) throw new Error(`${entry.id}: id does not match group/unit`);
    if (path.posix.basename(entry.output.path) !== `${entry.unit}.lean`) throw new Error(`${entry.id}: unit does not match output filename`);
    if (entry.module !== expectedModule(entry.output.path)) throw new Error(`${entry.id}: module does not match output path`);
    if (!entry.components.some((component) => component.role === "def")) throw new Error(`${entry.id}: missing def component`);
    assertUnique(entry.components.map((component) => component.role), `${entry.id} component role`);
    assertUnique(entry.imports, `${entry.id} import`);
    for (let index = 1; index < entry.components.length; index += 1) {
      if (roleIndex.get(entry.components[index - 1].role)! >= roleIndex.get(entry.components[index].role)!) {
        throw new Error(`${entry.id}: components are not in canonical order`);
      }
    }
    for (const component of entry.components) {
      const consumedKey = `${entry.sourceId}/${component.source.path}`;
      if (consumedPaths.has(consumedKey)) throw new Error(`source file is represented more than once: ${consumedKey}`);
      consumedPaths.add(consumedKey);
    }
    const roles = new Set(entry.components.map((component) => component.role));
    const kind = roles.has("props") ? "properties" : roles.has("proof") ? "proof" : "elaboration";
    if (entry.kind !== kind) throw new Error(`${entry.id}: kind does not match components`);
    const bytes = await verifyFile(root, entry.output);
    if (!bytes.subarray(0, 2048).toString("utf8").includes(GENERATED_MARKER)) {
      throw new Error(`${entry.id}: generated marker is missing`);
    }
    const text = bytes.toString("utf8");
    const parsed = parseLeanHeader(text, entry.output.path);
    const actualImports = parsed.imports.map((imported) => imported.module);
    if (JSON.stringify(actualImports) !== JSON.stringify(entry.imports)) {
      throw new Error(`${entry.id}: recorded imports do not match generated module`);
    }
    const actualProveCorrect = (text.match(/^\s*prove_correct\b/gm) ?? []).length;
    if (actualProveCorrect !== entry.proveCorrectCommands) {
      throw new Error(`${entry.id}: recorded prove_correct count does not match generated module`);
    }
    const componentBoundaries = (text.match(/^\/- BEGIN /gm) ?? []).length;
    if (componentBoundaries !== entry.components.length) {
      throw new Error(`${entry.id}: component boundary count does not match metadata`);
    }
  }

  const attribution = await verifyFile(root, metadata.attribution);
  const attributionText = attribution.toString("utf8");
  for (const source of metadata.sources) {
    for (const needle of [source.id, source.repository, source.license.spdx, source.license.output.path]) {
      if (!attributionText.includes(needle)) throw new Error(`attribution does not mention ${needle}`);
    }
  }

  const actualCounts = {
    sources: metadata.sources.length,
    supportFiles: metadata.support.length,
    cases: metadata.cases.length,
    components: metadata.cases.reduce((sum, entry) => sum + entry.components.length, 0),
    proofCases: metadata.cases.filter((entry) => entry.kind === "proof").length,
    propertyCases: metadata.cases.filter((entry) => entry.kind === "properties").length,
    elaborationCases: metadata.cases.filter((entry) => entry.kind === "elaboration").length,
    proveCorrectCommands: metadata.cases.reduce((sum, entry) => sum + entry.proveCorrectCommands, 0),
  };
  for (const key of Object.keys(actualCounts) as Array<keyof typeof actualCounts>) {
    if (metadata.counts[key] !== actualCounts[key]) throw new Error(`metadata count is wrong: ${key}`);
  }

  const represented = representedArtifactPaths(metadata);
  const actual = await actualManagedPaths(root);
  for (const expected of represented) if (!actual.has(expected)) throw new Error(`represented artifact is missing: ${expected}`);
  for (const found of actual) if (!represented.has(found)) throw new Error(`unlisted managed artifact: ${found}`);

  const toolchainPath = path.join(root, "lean-toolchain");
  if (await stat(toolchainPath).then(() => true).catch(() => false)) {
    const toolchain = (await readFile(toolchainPath, "utf8")).replace(/\r\n?/g, "\n").trim();
    if (toolchain !== metadata.leanToolchain) throw new Error("lean-toolchain does not match metadata");
  }
  return metadata;
}
