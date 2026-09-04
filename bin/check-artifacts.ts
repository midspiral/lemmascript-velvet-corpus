#!/usr/bin/env -S node --import tsx

import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateArtifactsAt } from "../src/artifacts.js";

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error("usage: npm run check-artifacts");
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const metadata = await validateArtifactsAt(repoRoot);
  console.log(
    `Artifacts are internally coherent: ${metadata.counts.cases} cases, ` +
    `${metadata.counts.components} components, ${metadata.counts.supportFiles} support files.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
