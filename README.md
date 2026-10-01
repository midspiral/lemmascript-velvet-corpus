# lemmascript-velvet-corpus

A reproducible corpus of real Lean workloads produced by LemmaScript, intended
for finding and profiling performance problems in Velvet 2. It is a
corpus of complete programs and proofs, not an agentic proof benchmark.

Each logical example is flattened into one Lean module. For example, the
`binarySearch.types/spec/def/proof.lean` chain becomes
`Corpus/Core/binarySearch.lean`. This matches Velvet's same-module interface
and makes every case easy to elaborate in isolation.

## Gather the snapshot

The configured inputs are sibling checkouts of `LemmaScript`,
`clear-split-lemmascript`, `colorwheel-lemmascript`,
`node-casbin-lemmascript`, and `pi-lemmascript`:

```sh
npm ci
npm run gather
```

Those five source checkouts and Node.js are needed only to regenerate or check
the snapshot. Building and profiling the committed corpus requires only this
repository, Lean, and the sibling Velvet checkout described below.

Only their Lean artifacts are consumed. The TypeScript here implements the
reproducible copy/concatenation step; application TypeScript is neither copied
nor compiled. Source paths and repositories are declared in
`config/sources.json`.

Useful integrity checks are:

```sh
npm run gather -- --check  # snapshot equals the sibling working trees
npm run check-artifacts    # committed snapshot is internally coherent
npm run typecheck
npm test
```

`--parent-dir PATH` overrides the sibling checkout parent. The gatherer never
clones, fetches, changes branches, or writes to a source checkout. See
`DESIGN.md` for the exact discovery, concatenation, provenance, and write-safety
rules.

## Build and inspect cases

The checked-in Lake setup uses Lean 4.34.0 and the sibling `../velvet`
checkout from the `lemma2` branch of
[`namin/velvet`](https://github.com/namin/velvet/tree/lemma2).
Velvet 2 no longer needs Loom or external SMT solvers.

The reference build uses Velvet
`22ed7829f4a90e786eed9b193d29fe46e61fe949`. The path dependency is deliberately
live so a Velvet developer measures their working tree; this hash is a
reproducible comparison point, not an enforced checkout action.

```sh
lake build                         # all groups and the section-boundary check
lake build CorpusCore             # one group
lake build CorpusColorWheel
lake env lean Corpus/Core/binarySearch.lean
```

## Compare two corpora

From the Velvet 2 corpus, compare against the sibling Velvet 1 snapshot:

```sh
npm run compare -- ../lemmascript-velvet-corpus1          # three runs per case
npm run compare -- ../lemmascript-velvet-corpus1 --runs 1 # quick first pass
```

The runner builds both checkouts first, outside the measured interval, then
runs `lake env lean` on each matching case. Runs are sequential and alternate
version order. It reports median wall-clock time per case and the overall
speedup: baseline time divided by current time. A value above 1 means the
current corpus is faster. Setup failures or failed elaborations stop the run.

Reports, raw samples, engine revisions, and logs go under ignored
`results/compare-*/`. Overall speedup uses the sum of per-case medians; the
report also gives the geometric mean of the case speedups. These measurements
cover complete module elaboration and compare both stacks, including their
Lean versions, imports, and migrated proofs.

Use `--case core/toposort` to select a case (repeatable), `--timeout 300` to
set the per-run limit in seconds, or `--no-build` if both workspaces were just
built. Run on an otherwise idle machine for useful timings.

See the [Velvet 2 VC generation refactor report](reports/velvet2-vcgen-refactor.md)
for exact proof transformations and the comparison against `velvet2-v0`, with
the engine and dependencies held constant.

## Profile a case

Lean's ordinary profiler prints elaboration and type-checking time by
declaration:

```sh
lake env lean --profile Corpus/Core/binarySearch.lean
```

For a nested trace suitable for loading in Firefox Profiler, write Lean's
structured profiler output beneath the ignored `results/` directory:

```sh
mkdir -p results
lake env lean \
  -Dtrace.profiler=true \
  -Dtrace.profiler.threshold=1 \
  -Dtrace.profiler.output=results/binarySearch.json \
  Corpus/Core/binarySearch.lean
```

Run `lake build` first so dependency compilation is outside the measurement.
The resulting time is for the complete combined module—types,
specifications, method elaboration, and proofs—not proof time alone.

To test another engine without editing `lakefile.lean`, put a path entry for
`velvet` in `.lake/package-overrides.json`, or pass an equivalent
file with Lake's `--packages` option. A path entry has this form (paths are
relative to this repository):

```json
{
  "schemaVersion": "1.1.0",
  "packages": [
    {
      "type": "path",
      "scope": "",
      "name": "velvet",
      "manifestFile": "lake-manifest.json",
      "inherited": false,
      "dir": "../my-velvet",
      "configFile": "lakefile.toml"
    }
  ]
}
```

`metadata.json` maps readable case IDs such as `core/binarySearch` to modules,
source components, hashes, imports, and Git provenance. Generated artifacts
are committed so a Velvet developer can clone the corpus and inspect its Lean
without installing LemmaScript's TypeScript compiler.

The corpus preserves source warnings and proof status. In particular,
ColorWheel currently contains the upstream admitted `adjustColorCommutes`
theorem; gathering does not remove or repair it.
