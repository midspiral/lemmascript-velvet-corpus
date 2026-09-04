import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CorpusConfig, GroupConfig, SourceConfig } from "./types.js";

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where} must be a non-empty string`);
  }
  return value;
}

function strings(value: unknown, where: string, optional = false): string[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value.map((entry, index) => string(entry, `${where}[${index}]`));
}

export function assertSafeRelativePath(value: string, where: string): void {
  if (path.isAbsolute(value) || value.includes("\\") || /[\0\r\n]/.test(value) || value.includes("/-") || value.includes("-/")) {
    throw new Error(`${where} must be a portable relative path: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (value === "." || value === ".." || normalized !== value || value.startsWith("../")) {
    throw new Error(`${where} is not a safe normalized relative path: ${value}`);
  }
}

function parseGroup(value: unknown, where: string): GroupConfig {
  const raw = object(value, where);
  const id = string(raw.id, `${where}.id`);
  const module = string(raw.module, `${where}.module`);
  const roots = strings(raw.roots, `${where}.roots`);
  const ignore = strings(raw.ignore, `${where}.ignore`, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${where}.id must be a lowercase slug: ${id}`);
  }
  if (!/^[A-Z][A-Za-z0-9_']*$/.test(module)) {
    throw new Error(`${where}.module must be a Lean identifier beginning with uppercase: ${module}`);
  }
  if (roots.length === 0) throw new Error(`${where}.roots must not be empty`);
  for (const [index, root] of roots.entries()) assertSafeRelativePath(root, `${where}.roots[${index}]`);
  for (const [index, ignored] of ignore.entries()) {
    assertSafeRelativePath(ignored, `${where}.ignore[${index}]`);
  }
  if (new Set(roots).size !== roots.length) throw new Error(`${where}.roots contains duplicates`);
  if (new Set(ignore).size !== ignore.length) throw new Error(`${where}.ignore contains duplicates`);
  return { id, module, roots, ignore };
}

function parseSource(value: unknown, where: string): SourceConfig {
  const raw = object(value, where);
  const source: SourceConfig = {
    id: string(raw.id, `${where}.id`),
    repo: string(raw.repo, `${where}.repo`),
    checkout: string(raw.checkout, `${where}.checkout`),
    branch: string(raw.branch, `${where}.branch`),
    license: string(raw.license, `${where}.license`),
    licenseFile: string(raw.licenseFile, `${where}.licenseFile`),
    support: strings(raw.support, `${where}.support`, true),
    groups: Array.isArray(raw.groups)
      ? raw.groups.map((group, index) => parseGroup(group, `${where}.groups[${index}]`))
      : (() => { throw new Error(`${where}.groups must be an array`); })(),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)) {
    throw new Error(`${where}.id must be a lowercase slug: ${source.id}`);
  }
  assertSafeRelativePath(source.checkout, `${where}.checkout`);
  assertSafeRelativePath(source.licenseFile, `${where}.licenseFile`);
  for (const [index, support] of source.support.entries()) {
    assertSafeRelativePath(support, `${where}.support[${index}]`);
  }
  if (source.groups.length === 0) throw new Error(`${where}.groups must not be empty`);
  return source;
}

export async function readConfig(configPath: string): Promise<CorpusConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = object(parsed, "config");
  if (raw.schemaVersion !== 1) throw new Error("config.schemaVersion must be 1");
  const parentDir = string(raw.parentDir, "config.parentDir");
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map((source, index) => parseSource(source, `config.sources[${index}]`))
    : (() => { throw new Error("config.sources must be an array"); })();
  if (sources.length === 0) throw new Error("config.sources must not be empty");
  if (parentDir.includes("\0") || parentDir.includes("\\")) {
    throw new Error("config.parentDir must be a portable path");
  }

  const sourceIds = new Set<string>();
  const checkouts = new Set<string>();
  const groupIds = new Set<string>();
  const groupModules = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) throw new Error(`duplicate source id: ${source.id}`);
    if (checkouts.has(source.checkout)) throw new Error(`duplicate checkout: ${source.checkout}`);
    sourceIds.add(source.id);
    checkouts.add(source.checkout);
    for (const group of source.groups) {
      if (groupIds.has(group.id)) throw new Error(`duplicate group id: ${group.id}`);
      if (groupModules.has(group.module.toLowerCase())) {
        throw new Error(`case-insensitive duplicate group module: ${group.module}`);
      }
      groupIds.add(group.id);
      groupModules.add(group.module.toLowerCase());
    }
  }
  return { schemaVersion: 1, parentDir, sources };
}

export function resolveParentDir(repoRoot: string, configured: string, override?: string): string {
  return path.resolve(repoRoot, override ?? configured);
}
