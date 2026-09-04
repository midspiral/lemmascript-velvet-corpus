#!/usr/bin/env -S node --import tsx

import { fileURLToPath } from "node:url";
import path from "node:path";
import { readConfig, resolveParentDir } from "../src/config.js";
import { gather } from "../src/emit.js";

interface Options {
  check: boolean;
  parentDir?: string;
}

function usage(): never {
  throw new Error("usage: npm run gather -- [--check] [--parent-dir PATH]");
}

function parseArgs(args: string[]): Options {
  const options: Options = { check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--parent-dir") {
      const value = args[index + 1];
      if (!value) usage();
      options.parentDir = value;
      index += 1;
    } else if (argument.startsWith("--parent-dir=")) {
      options.parentDir = argument.slice("--parent-dir=".length);
      if (!options.parentDir) usage();
    } else {
      usage();
    }
  }
  return options;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const options = parseArgs(process.argv.slice(2));
  const config = await readConfig(path.join(repoRoot, "config/sources.json"));
  const parentDir = resolveParentDir(repoRoot, config.parentDir, options.parentDir);
  const result = await gather(repoRoot, config, parentDir, options.check);
  for (const warning of result.branchWarnings) console.error(`WARNING: ${warning}`);
  const action = options.check
    ? "Artifacts are current"
    : `Gathered artifacts (${result.changed} written, ${result.removed} removed)`;
  console.log(
    `${action}: ${result.cases} cases, ${result.components} components, ` +
    `${result.proveCorrectCommands} prove_correct commands, ${result.supportFiles} support files.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
