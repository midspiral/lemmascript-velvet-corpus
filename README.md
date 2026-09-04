# lemmascript-velvet-corpus

A reproducible corpus of real Lean workloads produced by LemmaScript, intended
for finding and profiling performance problems in Velvet and Loom. It is a
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

The checked-in Lake setup uses the sibling `../velvet` and `../loom` checkouts
as its reference engine. At present that is the known-good LemmaScript stack:
concatenation removes the custom cross-module obligation-persistence
requirement, but some cases still exercise the `for ... in ...` and bounded
range-loop changes.

The reference build validated while creating this snapshot used Velvet
`5d6085bda021e1f967ed2f4d19c0a6e2d23a8f38` and Loom
`2f18de6c83130b8fd309d9fc390a627743fd92e0`. The path dependencies are
deliberately live so a Velvet developer measures their working tree; those
hashes are a reproducible comparison point, not an enforced checkout action.

```sh
lake build                         # all groups and the section-boundary check
lake build CorpusCore             # one group
lake build CorpusColorWheel
lake env lean Corpus/Core/binarySearch.lean
```

To test another engine without editing `lakefile.lean`, put path entries for
`Velvet` and `Loom` in `.lake/package-overrides.json`, or pass an equivalent
file with Lake's `--packages` option. A path entry has this form (paths are
relative to this repository):

```json
{
  "schemaVersion": "1.1.0",
  "packages": [
    {
      "type": "path",
      "scope": "",
      "name": "Velvet",
      "manifestFile": "lake-manifest.json",
      "inherited": false,
      "dir": "../my-velvet",
      "configFile": "lakefile.lean"
    },
    {
      "type": "path",
      "scope": "",
      "name": "Loom",
      "manifestFile": "lake-manifest.json",
      "inherited": false,
      "dir": "../my-loom",
      "configFile": "lakefile.lean"
    }
  ]
}
```

`metadata.json` maps readable case IDs such as `core/binarySearch` to modules,
source components, hashes, imports, and Git provenance. Generated artifacts
are committed so a Velvet developer can clone the corpus and inspect its Lean
without installing LemmaScript's TypeScript compiler.
