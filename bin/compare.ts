#!/usr/bin/env -S node --import tsx

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateArtifactsAt } from "../src/artifacts.js";

const usage = "npm run compare -- BASELINE_DIR [--runs 3] [--case core/binarySearch] [--timeout 300] [--no-build]";

function positiveInteger(value: string, name: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
  return result;
}

function git(root: string): { revision: string | null; status: string | null } {
  function run(args: string[]): string | null {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : null;
  }
  return { revision: run(["rev-parse", "HEAD"]), status: run(["status", "--porcelain=v1"]) };
}

async function fingerprint(root: string, file: string): Promise<string> {
  return createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
}

async function describe(root: string) {
  const manifest = JSON.parse(await readFile(path.join(root, "lake-manifest.json"), "utf8"));
  const overrides = await readFile(path.join(root, ".lake/package-overrides.json"), "utf8")
    .then((text) => JSON.parse(text))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return { packages: [] };
    });
  const packages = new Map<string, { name: string; type: string; dir?: string }>();
  for (const entry of [...manifest.packages, ...overrides.packages]) packages.set(entry.name, entry);
  const dependencies = [...packages.values()].filter((entry) => entry.type === "path").map((entry) => {
    const directory = path.resolve(root, entry.dir!);
    return { name: entry.name, directory, ...git(directory) };
  });
  return {
    directory: root, ...git(root), dependencies,
    toolchain: (await readFile(path.join(root, "lean-toolchain"), "utf8")).trim(),
    metadataSha256: await fingerprint(root, "metadata.json"),
    manifestSha256: await fingerprint(root, "lake-manifest.json"),
    overrides,
  };
}

function run(root: string, args: string[], log: string, timeout?: number): number {
  const fd = openSync(log, "w");
  const start = process.hrtime.bigint();
  try {
    const result = spawnSync("lake", args, { cwd: root, stdio: ["ignore", fd, fd], timeout });
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    if (result.error || result.status !== 0) {
      throw new Error(`lake ${args.join(" ")} failed (${result.error?.message ?? result.signal ?? result.status}); see ${log}`);
    }
    return seconds;
  } finally {
    closeSync(fd);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface Row {
  id: string;
  group: string;
  kind: string;
  sourceChanged: boolean;
  baselineSamples: number[];
  candidateSamples: number[];
  baselineSeconds: number;
  candidateSeconds: number;
  speedup: number;
}

function totals(rows: Row[]) {
  const baselineSeconds = rows.reduce((sum, row) => sum + row.baselineSeconds, 0);
  const candidateSeconds = rows.reduce((sum, row) => sum + row.candidateSeconds, 0);
  return { baselineSeconds, candidateSeconds, speedup: baselineSeconds / candidateSeconds };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      runs: { type: "string", default: "3" },
      case: { type: "string", multiple: true },
      timeout: { type: "string", default: "300" },
      "no-build": { type: "boolean", default: false },
      help: { type: "boolean" },
    },
  });
  if (values.help) { console.log(usage); return; }
  if (positionals.length !== 1) throw new Error(usage);
  const runs = positiveInteger(values.runs!, "--runs");
  const timeout = positiveInteger(values.timeout!, "--timeout") * 1000;
  const candidate = await realpath(fileURLToPath(new URL("..", import.meta.url)));
  const baseline = await realpath(path.resolve(positionals[0]));
  if (candidate === baseline) throw new Error("Baseline and candidate must be different checkouts");
  const oldMetadata = await validateArtifactsAt(baseline);
  const newMetadata = await validateArtifactsAt(candidate);
  const oldCases = new Map(oldMetadata.cases.map((entry) => [entry.id, entry]));
  const newCases = new Map(newMetadata.cases.map((entry) => [entry.id, entry]));
  const ids = values.case ? [...new Set(values.case)].sort() : [...newCases.keys()].sort();
  if (!values.case && oldCases.size !== newCases.size) throw new Error("Case sets differ; select matching cases with --case");
  for (const id of ids) {
    if (!oldCases.has(id) || !newCases.has(id)) throw new Error(`Case missing from one checkout: ${id}`);
    if (oldCases.get(id)!.kind !== newCases.get(id)!.kind ||
        oldCases.get(id)!.proveCorrectCommands !== newCases.get(id)!.proveCorrectCommands) {
      throw new Error(`Proof workload changed for ${id}: kind or prove_correct count differs`);
    }
  }
  if (ids.length === 0) throw new Error("No cases to compare");
  await mkdir(path.join(candidate, "results"), { recursive: true });
  const output = await mkdtemp(path.join(candidate, "results", "compare-"));
  console.log(`Reports and logs: ${output}`);
  if (!values["no-build"]) {
    for (const [label, root] of [["baseline", baseline], ["candidate", candidate]]) {
      console.log(`Preparing ${label}: lake build (excluded from timing)`);
      run(root, ["build"], path.join(output, `${label}-build.log`));
    }
  }
  const provenance = {
    startedAt: new Date().toISOString(), runs, timeoutSeconds: timeout / 1000,
    command: "lake env lean <case>", builtBeforeTiming: !values["no-build"],
    machine: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, cpus: os.cpus().length },
    baseline: await describe(baseline), candidate: await describe(candidate),
  };
  await writeFile(path.join(output, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
  const rows: Row[] = [];
  for (const [index, id] of ids.entries()) {
    const before = oldCases.get(id)!;
    const after = newCases.get(id)!;
    const samples = { baseline: [] as number[], candidate: [] as number[] };
    for (let round = 0; round < runs; round += 1) {
      const order = (index + round) % 2 === 0
        ? ["baseline", "candidate"] as const : ["candidate", "baseline"] as const;
      for (const side of order) {
        const root = side === "baseline" ? baseline : candidate;
        const entry = side === "baseline" ? before : after;
        const log = path.join(output, `${index + 1}-${side}-${round + 1}.log`);
        console.log(`[${index + 1}/${ids.length}] ${id}: ${side}, run ${round + 1}/${runs}`);
        const seconds = run(root, ["env", "lean", entry.output.path], log, timeout);
        samples[side].push(seconds);
        appendFileSync(path.join(output, "samples.jsonl"), JSON.stringify({ id, side, round: round + 1, seconds, log }) + "\n");
      }
    }
    const baselineSeconds = median(samples.baseline);
    const candidateSeconds = median(samples.candidate);
    rows.push({
      id, group: after.group, kind: after.kind, sourceChanged: before.output.sha256 !== after.output.sha256,
      baselineSamples: samples.baseline, candidateSamples: samples.candidate,
      baselineSeconds, candidateSeconds, speedup: baselineSeconds / candidateSeconds,
    });
    console.log(`  ${baselineSeconds.toFixed(3)}s / ${candidateSeconds.toFixed(3)}s = ${(baselineSeconds / candidateSeconds).toFixed(2)}x`);
  }
  for (const side of [provenance.baseline, provenance.candidate]) {
    await validateArtifactsAt(side.directory);
    if (side.metadataSha256 !== await fingerprint(side.directory, "metadata.json") ||
        side.manifestSha256 !== await fingerprint(side.directory, "lake-manifest.json")) {
      throw new Error(`Snapshot or dependencies changed during measurement: ${side.directory}`);
    }
  }
  const total = totals(rows);
  const geometricMeanSpeedup = Math.exp(rows.reduce((sum, row) => sum + Math.log(row.speedup), 0) / rows.length);
  const groups = [...new Set(rows.map((row) => row.group))].map((group) => ({ group, ...totals(rows.filter((row) => row.group === group)) }));
  await writeFile(path.join(output, "timings.json"), JSON.stringify({ ...provenance, total, geometricMeanSpeedup, groups, cases: rows }, null, 2) + "\n");
  const tableRow = (name: string, row: ReturnType<typeof totals>) =>
    `| ${name} | ${row.baselineSeconds.toFixed(3)} | ${row.candidateSeconds.toFixed(3)} | ${row.speedup.toFixed(2)}x |`;
  const report = [
    "# Corpus timing comparison", "",
    `Baseline: \`${baseline}\` (${provenance.baseline.toolchain}, ${provenance.baseline.revision}).`,
    `Candidate: \`${candidate}\` (${provenance.candidate.toolchain}, ${provenance.candidate.revision}).`, "",
    `${runs} run(s) per case and version, sequential with alternating version order.`,
    "Times are median wall-clock seconds for `lake env lean <case>`, including process startup, imports, definitions, and proofs; dependency builds are excluded.",
    `${rows.filter((row) => row.sourceChanged).length}/${rows.length} case files differ. This compares the complete stacks and migrated workloads, not Velvet alone.`,
    runs === 1 ? "Single-pass estimate; repeat with --runs 3 before drawing conclusions about small differences." : "Raw samples and logs are retained alongside this report.", "",
    `Overall speedup (sum of per-case medians): **${total.speedup.toFixed(2)}x** (${total.baselineSeconds.toFixed(3)}s / ${total.candidateSeconds.toFixed(3)}s).`,
    `Geometric mean of case speedups: **${geometricMeanSpeedup.toFixed(2)}x**. Values above 1 favor the candidate.`, "",
    "| Group | Baseline (s) | Candidate (s) | Speedup |", "|---|---:|---:|---:|",
    ...groups.map((entry) => tableRow(entry.group, entry)), "",
    "| Case | Baseline (s) | Candidate (s) | Speedup |", "|---|---:|---:|---:|",
    ...rows.map((row) => tableRow(row.id, row)), "",
  ].join("\n");
  await writeFile(path.join(output, "summary.md"), report);
  console.log(`Overall: ${total.speedup.toFixed(2)}x; geometric mean: ${geometricMeanSpeedup.toFixed(2)}x`);
  console.log(`Report: ${path.join(output, "summary.md")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
