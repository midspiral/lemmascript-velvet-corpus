import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  CaseKind,
  CaseMetadata,
  ComponentMetadata,
  CorpusConfig,
  CorpusCounts,
  CorpusMetadata,
  DiscoveredCase,
  Snapshot,
  SourceConfig,
  SourceMetadata,
  SupportMetadata,
} from "./types.js";
import { COMPONENT_ROLES } from "./types.js";
import { discoverCases } from "./discover.js";
import {
  GENERATED_MARKER,
  decodeUtf8,
  expandFiles,
  listFilesRecursive,
  normalizeLf,
  pathFacts,
  readBytes,
  stableJson,
  toPosix,
} from "./files.js";
import { parseLeanHeader } from "./lean-header.js";
import { representedArtifactPaths, validateArtifactsAt } from "./artifacts.js";

const MANAGED_DIRECTORIES = ["Corpus", "LemmaScript", "LICENSES"] as const;
const MANAGED_ROOT_FILES = ["LemmaScript.lean", "metadata.json"] as const;

function renderModuleSegment(segment: string): string {
  return /^[A-Za-z_][A-Za-z0-9_']*$/.test(segment) ? segment : `«${segment}»`;
}

export function moduleNameFor(groupModule: string, unit: string): string {
  return `Corpus.${groupModule}.${renderModuleSegment(unit)}`;
}

function caseKind(roles: Set<string>): CaseKind {
  if (roles.has("props")) return "properties";
  if (roles.has("proof")) return "proof";
  return "elaboration";
}

interface EmittedCase {
  bytes: Buffer;
  imports: string[];
  components: ComponentMetadata[];
  proveCorrectCommands: number;
}

export async function emitCase(
  discovered: DiscoveredCase,
  allLocalModules: ReadonlySet<string>,
): Promise<EmittedCase> {
  const ownExistingModules = new Set(discovered.components.map((component) => `${discovered.unit}.${component.role}`));
  const ownPossibleModules = new Set(COMPONENT_ROLES.map((role) => `${discovered.unit}.${role}`));
  const externalByModule = new Map<string, string>();
  const bodies: Array<{ sourceLabel: string; body: string }> = [];
  const components: ComponentMetadata[] = [];
  let proveCorrectCommands = 0;

  for (const component of discovered.components) {
    const sourceBytes = await readBytes(component.absolutePath);
    const sourceText = decodeUtf8(sourceBytes, `${discovered.sourceId}/${component.sourcePath}`);
    const parsed = parseLeanHeader(sourceText, `${discovered.sourceId}/${component.sourcePath}`);
    for (const imported of parsed.imports) {
      if (ownPossibleModules.has(imported.module)) {
        if (!ownExistingModules.has(imported.module)) {
          throw new Error(`${discovered.id}: ${component.sourcePath} imports missing component ${imported.module}`);
        }
        const importedRole = imported.module.slice(discovered.unit.length + 1) as (typeof COMPONENT_ROLES)[number];
        if (COMPONENT_ROLES.indexOf(importedRole) >= COMPONENT_ROLES.indexOf(component.role)) {
          throw new Error(`${discovered.id}: ${component.sourcePath} has a forward or self import (${imported.module})`);
        }
        continue;
      }
      if (allLocalModules.has(imported.module)) {
        throw new Error(`${discovered.id}: ${component.sourcePath} imports a different corpus unit (${imported.module})`);
      }
      if (!externalByModule.has(imported.module)) externalByModule.set(imported.module, imported.raw);
    }
    proveCorrectCommands += (parsed.body.match(/^\s*prove_correct\b/gm) ?? []).length;
    const sourceLabel = `${discovered.checkout}/${component.sourcePath}`;
    bodies.push({ sourceLabel, body: parsed.body });
    components.push({ role: component.role, source: pathFacts(component.sourcePath, sourceBytes) });
  }

  const sourceList = bodies.map(({ sourceLabel }) => `  ${sourceLabel}`).join("\n");
  const imports = [...externalByModule.values()];
  const importBlock = imports.map((module) => `import ${module}`).join("\n");
  const bodyBlocks = bodies.map(({ sourceLabel, body }) => {
    const content = body.length === 0 ? "" : body.endsWith("\n") ? body : `${body}\n`;
    return `/- BEGIN ${sourceLabel} -/\nsection\n${content}end\n/- END ${sourceLabel} -/`;
  });
  const header = `/-\n${GENERATED_MARKER}\n\nSource components, in order:\n${sourceList}\n-/`;
  const text = [header, importBlock, ...bodyBlocks].filter((part) => part.length > 0).join("\n\n") + "\n";
  return {
    bytes: Buffer.from(text),
    imports: [...externalByModule.keys()],
    components,
    proveCorrectCommands,
  };
}

function runGit(checkoutRoot: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", checkoutRoot, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sourceAttribution(config: CorpusConfig): Buffer {
  const rows = config.sources.map((source) => {
    const groups = source.groups.map((group) => group.id).join(", ");
    return `| ${source.id} | ${groups} | [${source.repo}](https://github.com/${source.repo}) | ${source.license} | [\`LICENSES/${source.id}.txt\`](../LICENSES/${source.id}.txt) |`;
  });
  return Buffer.from([
    "<!-- Generated by `npm run gather`. Do not edit. -->",
    "# Corpus attribution",
    "",
    "Each generated Lean case remains governed by its source repository's license.",
    "The corpus preserves source comments and includes a copy of every represented license.",
    "",
    "| Source | Corpus group(s) | Repository | License | Copy |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"));
}

function countsFor(sources: SourceMetadata[], support: SupportMetadata[], cases: CaseMetadata[]): CorpusCounts {
  return {
    sources: sources.length,
    supportFiles: support.length,
    cases: cases.length,
    components: cases.reduce((sum, entry) => sum + entry.components.length, 0),
    proofCases: cases.filter((entry) => entry.kind === "proof").length,
    propertyCases: cases.filter((entry) => entry.kind === "properties").length,
    elaborationCases: cases.filter((entry) => entry.kind === "elaboration").length,
    proveCorrectCommands: cases.reduce((sum, entry) => sum + entry.proveCorrectCommands, 0),
  };
}

async function sourceMetadata(
  source: SourceConfig,
  checkoutRoot: string,
  relevantPaths: string[],
  licenseBytes: Buffer,
): Promise<SourceMetadata> {
  const head = runGit(checkoutRoot, ["rev-parse", "--verify", "HEAD"]);
  const observedBranch = runGit(checkoutRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const status = runGit(checkoutRoot, ["status", "--porcelain=v1", "--", ...relevantPaths]);
  const licenseOutput = `LICENSES/${source.id}.txt`;
  return {
    id: source.id,
    repository: source.repo,
    checkout: source.checkout,
    expectedBranch: source.branch,
    observedBranch,
    head,
    relevantDirty: status === null ? null : status.length > 0,
    branchMatches: head === null && observedBranch === null ? null : observedBranch === source.branch,
    license: {
      spdx: source.license,
      source: pathFacts(source.licenseFile, licenseBytes),
      output: pathFacts(licenseOutput, licenseBytes),
    },
  };
}

export async function buildSnapshot(
  repoRoot: string,
  config: CorpusConfig,
  parentDir: string,
): Promise<Snapshot> {
  const discovery = await discoverCases(config, parentDir);
  const files = new Map<string, Buffer>();
  const cases: CaseMetadata[] = [];
  const support: SupportMetadata[] = [];
  const sources: SourceMetadata[] = [];

  for (const discovered of discovery.cases) {
    const emitted = await emitCase(discovered, discovery.localModules);
    const outputPath = `Corpus/${discovered.groupModule}/${discovered.unit}.lean`;
    if (files.has(outputPath)) throw new Error(`two inputs map to ${outputPath}`);
    files.set(outputPath, emitted.bytes);
    const roles = new Set(discovered.components.map((component) => component.role));
    cases.push({
      id: discovered.id,
      unit: discovered.unit,
      group: discovered.groupId,
      sourceId: discovered.sourceId,
      module: moduleNameFor(discovered.groupModule, discovered.unit),
      kind: caseKind(roles),
      imports: emitted.imports,
      components: emitted.components,
      proveCorrectCommands: emitted.proveCorrectCommands,
      output: pathFacts(outputPath, emitted.bytes),
    });
  }

  for (const source of config.sources) {
    const checkoutRoot = path.join(parentDir, source.checkout);
    const selectedSupport = await expandFiles(checkoutRoot, source.support, `${source.id}.support`);
    const relevantPaths = new Set<string>([source.licenseFile, ...selectedSupport]);
    for (const entry of cases.filter((candidate) => candidate.sourceId === source.id)) {
      for (const component of entry.components) relevantPaths.add(component.source.path);
    }

    for (const sourcePath of selectedSupport) {
      const bytes = await readBytes(path.join(checkoutRoot, sourcePath));
      const outputPath = sourcePath;
      if (files.has(outputPath)) throw new Error(`support output collision: ${outputPath}`);
      files.set(outputPath, bytes);
      support.push({
        sourceId: source.id,
        source: pathFacts(sourcePath, bytes),
        output: pathFacts(outputPath, bytes),
      });
    }

    const licenseBytes = await readBytes(path.join(checkoutRoot, source.licenseFile));
    const licenseOutput = `LICENSES/${source.id}.txt`;
    if (files.has(licenseOutput)) throw new Error(`license output collision: ${licenseOutput}`);
    files.set(licenseOutput, licenseBytes);
    sources.push(await sourceMetadata(source, checkoutRoot, [...relevantPaths].sort(), licenseBytes));
  }

  cases.sort((a, b) => a.id.localeCompare(b.id, "en"));
  support.sort((a, b) => a.output.path.localeCompare(b.output.path, "en"));
  sources.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const attributionBytes = sourceAttribution(config);
  const attributionPath = "Corpus/ATTRIBUTION.md";
  files.set(attributionPath, attributionBytes);

  const toolchainBytes = await readFile(path.join(repoRoot, "lean-toolchain"));
  const leanToolchain = normalizeLf(decodeUtf8(toolchainBytes, "lean-toolchain")).trim();
  if (leanToolchain.length === 0 || leanToolchain.includes("\n")) {
    throw new Error("lean-toolchain must contain exactly one non-empty line");
  }
  const metadata: CorpusMetadata = {
    schemaVersion: 1,
    generator: "npm run gather",
    leanToolchain,
    counts: countsFor(sources, support, cases),
    sources,
    support,
    cases,
    attribution: pathFacts(attributionPath, attributionBytes),
  };
  files.set("metadata.json", stableJson(metadata));
  return { files, metadata };
}

async function writeSnapshot(root: string, snapshot: Snapshot): Promise<void> {
  for (const [relativePath, bytes] of [...snapshot.files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }
}

async function managedFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const directory of MANAGED_DIRECTORIES) {
    for (const child of await listFilesRecursive(path.join(root, directory))) {
      output.push(toPosix(path.join(directory, child)));
    }
  }
  for (const file of MANAGED_ROOT_FILES) {
    const info = await stat(path.join(root, file)).catch(() => null);
    if (info?.isFile()) output.push(file);
  }
  return output.sort((a, b) => a.localeCompare(b, "en"));
}

async function priorRepresentedPaths(repoRoot: string): Promise<Set<string> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(repoRoot, "metadata.json"), "utf8"));
    return representedArtifactPaths(parsed);
  } catch {
    return null;
  }
}

async function carriesMarker(absolute: string): Promise<boolean> {
  try {
    const bytes = await readFile(absolute);
    return bytes.subarray(0, 2048).toString("utf8").includes(GENERATED_MARKER);
  } catch {
    return false;
  }
}

async function compareSnapshot(repoRoot: string, snapshot: Snapshot): Promise<string[]> {
  const differences: string[] = [];
  for (const [relativePath, expected] of snapshot.files) {
    const actual = await readFile(path.join(repoRoot, relativePath)).catch(() => null);
    if (actual === null) differences.push(`missing ${relativePath}`);
    else if (!actual.equals(expected)) differences.push(`different ${relativePath}`);
  }
  const expectedPaths = new Set(snapshot.files.keys());
  for (const actualPath of await managedFiles(repoRoot)) {
    if (!expectedPaths.has(actualPath)) differences.push(`stale or unrecognized ${actualPath}`);
  }
  return differences.sort((a, b) => a.localeCompare(b, "en"));
}

async function removeEmptyManagedDirectories(repoRoot: string): Promise<void> {
  for (const managed of MANAGED_DIRECTORIES) {
    const root = path.join(repoRoot, managed);
    const directories: string[] = [];
    async function visit(directory: string): Promise<void> {
      const entries = await import("node:fs/promises").then(({ readdir }) =>
        readdir(directory, { withFileTypes: true }).catch(() => []),
      );
      for (const entry of entries) if (entry.isDirectory()) await visit(path.join(directory, entry.name));
      directories.push(directory);
    }
    await visit(root);
    for (const directory of directories) {
      if (directory === root) continue;
      await import("node:fs/promises").then(({ rmdir }) => rmdir(directory).catch(() => undefined));
    }
  }
}

export interface GatherResult {
  cases: number;
  components: number;
  supportFiles: number;
  proveCorrectCommands: number;
  changed: number;
  removed: number;
  branchWarnings: string[];
}

export async function gather(
  repoRoot: string,
  config: CorpusConfig,
  parentDir: string,
  check: boolean,
): Promise<GatherResult> {
  const snapshot = await buildSnapshot(repoRoot, config, parentDir);
  const branchWarnings = snapshot.metadata.sources
    .filter((source) => source.branchMatches === false)
    .map((source) => `${source.id}: expected branch ${source.expectedBranch}, observed ${source.observedBranch}`);
  const temporary = await mkdtemp(path.join(tmpdir(), "lemmascript-velvet-corpus-"));
  try {
    await writeSnapshot(temporary, snapshot);
    await validateArtifactsAt(temporary);
    const differences = await compareSnapshot(repoRoot, snapshot);
    if (check) {
      if (differences.length > 0) {
        throw new Error(`generated artifacts are not current:\n${differences.map((entry) => `  - ${entry}`).join("\n")}`);
      }
      return {
        cases: snapshot.metadata.counts.cases,
        components: snapshot.metadata.counts.components,
        supportFiles: snapshot.metadata.counts.supportFiles,
        proveCorrectCommands: snapshot.metadata.counts.proveCorrectCommands,
        changed: 0,
        removed: 0,
        branchWarnings,
      };
    }

    const prior = await priorRepresentedPaths(repoRoot);
    const expectedPaths = new Set(snapshot.files.keys());
    const currentPaths = await managedFiles(repoRoot);
    const stale = currentPaths.filter((entry) => !expectedPaths.has(entry));
    for (const relativePath of stale) {
      const recognized = prior?.has(relativePath) || await carriesMarker(path.join(repoRoot, relativePath));
      if (!recognized) throw new Error(`refusing to remove unrecognized managed file: ${relativePath}`);
    }
    for (const [relativePath, bytes] of snapshot.files) {
      const absolute = path.join(repoRoot, relativePath);
      const existing = await readFile(absolute).catch(() => null);
      if (existing !== null && !existing.equals(bytes)) {
        const recognized = prior?.has(relativePath) || await carriesMarker(absolute);
        if (!recognized) throw new Error(`refusing to overwrite unrecognized managed file: ${relativePath}`);
      }
    }

    for (const relativePath of stale) await unlink(path.join(repoRoot, relativePath));
    let changed = 0;
    for (const [relativePath, bytes] of snapshot.files) {
      const absolute = path.join(repoRoot, relativePath);
      const existing = await readFile(absolute).catch(() => null);
      if (existing?.equals(bytes)) continue;
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
      changed += 1;
    }
    await removeEmptyManagedDirectories(repoRoot);
    await validateArtifactsAt(repoRoot);
    return {
      cases: snapshot.metadata.counts.cases,
      components: snapshot.metadata.counts.components,
      supportFiles: snapshot.metadata.counts.supportFiles,
      proveCorrectCommands: snapshot.metadata.counts.proveCorrectCommands,
      changed,
      removed: stale.length,
      branchWarnings,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
