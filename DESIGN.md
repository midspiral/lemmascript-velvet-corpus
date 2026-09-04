# lemmascript-velvet-corpus design

## Purpose

This repository is a runnable corpus of real LemmaScript-produced Lean
workloads for developing and profiling Velvet and Loom.

It is not an agentic-proof benchmark. There is no missing-proof task, candidate
solution, score, or admission gate. The useful experiment is normally:

1. hold a corpus commit fixed;
2. change Velvet or Loom; and
3. rebuild or profile the same Lean modules.

The committed corpus is therefore a normalized snapshot, not a live view of
the case-study repositories. A TypeScript gatherer reads sibling checkouts and
regenerates that snapshot when their Lean artifacts change.

### Non-goals

- Do not copy the TypeScript applications from LemmaScript or the case studies.
- Do not regenerate Lean from TypeScript here. Source repositories remain
  responsible for keeping their generated Lean current.
- Do not vendor Velvet, Loom, Mathlib, solvers, `.olean` files, or `.lake`
  directories.
- Do not rank proofs or treat machine-dependent wall time as a universal score.
- Do not preserve application-repository directory structure when it has no
  meaning for the Lean workload.

The only TypeScript committed here is repository tooling: gathering, artifact
checking, and eventually profiling. This follows the useful parts of
`lemmascript-dafny-benchmark` without importing its proof-task machinery.

## Inputs

The initial source list is the LemmaScript core examples plus the four case
studies in the current Lean CI matrix. Checkouts are siblings of this repository
under one parent directory.

| Group | Checkout | Lean source roots |
|---|---|---|
| Core | `../LemmaScript` | `examples` |
| ClearSplit | `../clear-split-lemmascript` | `src/logic` |
| ColorWheel | `../colorwheel-lemmascript` | `src` |
| NodeCasbin | `../node-casbin-lemmascript` | `src/effect`, `src/util`, `src/model` |
| Pi | `../pi-lemmascript` | `packages/coding-agent/src/utils`, `packages/agent/src/harness/compaction`, `packages/coding-agent/src/core/compaction`, `packages/coding-agent/src/core/tools` |

The reusable Lean support library comes from:

```text
../LemmaScript/LemmaScript.lean
../LemmaScript/LemmaScript/*.lean
```

The source list is transcribed into `config/sources.json`. The gatherer does not
parse LemmaScript CI on every run: a workflow refactor must not silently change
the corpus. Adding a source repository or source root is an explicit, reviewable
configuration change.

The initial configuration has this shape (the `_comment` field may carry the
seeding provenance):

```json
{
  "schemaVersion": 1,
  "parentDir": "..",
  "sources": [
    {
      "id": "lemmascript",
      "repo": "midspiral/LemmaScript",
      "checkout": "LemmaScript",
      "branch": "main",
      "license": "MIT",
      "licenseFile": "LICENSE",
      "support": ["LemmaScript.lean", "LemmaScript"],
      "groups": [
        { "id": "core", "module": "Core", "roots": ["examples"] }
      ]
    },
    {
      "id": "clear-split",
      "repo": "midspiral/clear-split-lemmascript",
      "checkout": "clear-split-lemmascript",
      "branch": "main",
      "license": "MIT",
      "licenseFile": "LICENSE",
      "groups": [
        { "id": "clear-split", "module": "ClearSplit", "roots": ["src/logic"] }
      ]
    },
    {
      "id": "colorwheel",
      "repo": "midspiral/colorwheel-lemmascript",
      "checkout": "colorwheel-lemmascript",
      "branch": "main",
      "license": "MIT",
      "licenseFile": "LICENSE",
      "groups": [
        { "id": "colorwheel", "module": "ColorWheel", "roots": ["src"] }
      ]
    },
    {
      "id": "node-casbin",
      "repo": "midspiral/node-casbin-lemmascript",
      "checkout": "node-casbin-lemmascript",
      "branch": "lemmascript",
      "license": "Apache-2.0",
      "licenseFile": "LICENSE",
      "groups": [
        {
          "id": "node-casbin",
          "module": "NodeCasbin",
          "roots": ["src/effect", "src/util", "src/model"]
        }
      ]
    },
    {
      "id": "pi",
      "repo": "midspiral/pi-lemmascript",
      "checkout": "pi-lemmascript",
      "branch": "lemmascript",
      "license": "MIT",
      "licenseFile": "LICENSE",
      "groups": [
        {
          "id": "pi",
          "module": "Pi",
          "roots": [
            "packages/coding-agent/src/utils",
            "packages/agent/src/harness/compaction",
            "packages/coding-agent/src/core/compaction",
            "packages/coding-agent/src/core/tools"
          ]
        }
      ]
    }
  ]
}
```

A `support` entry names a file or a directory of `.lean` files to copy while
preserving its path relative to the checkout. Group output is derived from its
`module` as `Corpus/<module>/`; it is not another independently editable path.
An optional group-level `ignore` array is the only way to acknowledge an
otherwise unexpected immediate-child `.lean` file.

`LemmaScript-files.txt` is not the inventory here. It describes TypeScript
compilation and can contain entries with no Lean artifacts; this corpus is
defined by the Lean files in the explicitly configured roots.

The current input has 45 logical units: 34 core examples and 11 external case
study units. Thirty-six have `.proof.lean` components, nine are
elaboration-only, and the proof files contain 158 `prove_correct` commands.
These counts describe the initial snapshot, not invariants hard-coded into the
gatherer.

### Checkout policy

The gatherer assumes the checkouts exist. It does not clone, fetch, switch
branches, regenerate source artifacts, or write outside this repository.

It consumes the working tree as-is, including relevant uncommitted changes.
That is useful while developing a case study. For provenance it records:

- the configured repository and expected branch;
- the observed Git HEAD and branch, when available;
- whether any consumed path differs from HEAD; and
- SHA-256, byte count, and line count for every consumed file.

Input hashes are authoritative when the working tree is dirty. Unrelated dirty
or untracked files do not change corpus metadata.

The configured branch is provenance, not an instruction to mutate a checkout.
A mismatch is printed prominently and recorded in metadata, but the observed
working tree is still gathered.

## One module per logical unit

The canonical corpus unit is one self-contained Lean module per logical
LemmaScript unit, not the emitted multi-module layout.

For example, the source components

```text
binarySearch.types.lean
binarySearch.spec.lean
binarySearch.def.lean
binarySearch.proof.lean
```

produce:

```text
Corpus/Core/binarySearch.lean
```

Components are ordered:

```text
types -> spec -> def -> proof -> props
```

Missing optional stages are skipped. Every discovered unit must have exactly
one `.def.lean`; it may have at most one component of each other role. A unit
without `proof` or `props` remains in the corpus as an elaboration workload.

This normalization matters because Velvet originally expects a method and its
`prove_correct` command in the same module. Making that the corpus form avoids
requiring LemmaScript's cross-module obligation-persistence extension merely
to present an otherwise ordinary Velvet workload. Split-file persistence is a
Velvet integration regression and belongs in Velvet's tests, not in every
corpus case.

### Concatenation is structural, not textual `cat`

Lean import commands belong in the module header, so the gatherer performs a
small, deliberately conservative transformation:

1. Read components in role order.
2. Extract their header imports.
3. Remove imports of another component of the same unit, such as
   `import «binarySearch.def»`.
4. Deduplicate remaining external imports by normalized module name while
   retaining first-seen order.
5. Emit those imports once at the top.
6. Emit each component body, unchanged apart from its removed import commands,
   inside a generated anonymous `section`, with source-boundary comments.

Thus imports such as `LemmaScript`, `LemmaScript.JSString`, `Velvet.Syntax`,
`Velvet.Std`, and `Mathlib.Tactic` remain. The local
`binarySearch.types`/`spec`/`def`/`proof` chain disappears because all of those
declarations now precede the proof in one module.

The generated sections approximate the scoping boundary that separate modules
used to provide. In particular, file-local options, `open` commands, local
instances, and local attributes must not leak into the next component. This is
observable today: `colorwheel.proof.lean` installs a local `grind` attribute
that `colorwheel.props.lean`, when imported normally, does not inherit.

Sections do not namespace declarations. Ordinary definitions and the Velvet
obligation created by a `method` remain in the environment for the later proof,
while scoped elaboration state is restored at `end`. The Lean compatibility
suite must exercise this property against the selected Velvet versions rather
than relying only on TypeScript text fixtures.

The generated header names the source component paths, but does not include
timestamps, absolute checkout paths, branches, or Git revisions. Moving HEAD
without changing a consumed file may update metadata, but must not perturb the
Lean workload itself.

Conceptually, a generated file begins:

```lean
/-
Generated by `npm run gather`. Do not edit.

Source components, in order:
  LemmaScript/examples/binarySearch.types.lean
  LemmaScript/examples/binarySearch.spec.lean
  LemmaScript/examples/binarySearch.def.lean
  LemmaScript/examples/binarySearch.proof.lean
-/

import LemmaScript

/- BEGIN binarySearch.types.lean -/
section
...
end
/- END binarySearch.types.lean -/

/- BEGIN binarySearch.spec.lean -/
section
...
end
```

The transformation must not rename declarations, introduce namespaces,
reformat tactics, reorder commands inside a component, or simplify source.
The anonymous wrapper cannot collide with a source section name. Line endings
are normalized to LF and every generated file ends with one newline.

### Import parser boundary

The gatherer does not need a Lean declaration parser. It does need a correct
parser for the constrained module header it transforms.

The first implementation supports the forms present in the corpus: top-level,
single-line `import <module>` commands, including quoted identifiers such as
`«binarySearch.def»`, interspersed with blank lines and Lean comments. Header
scanning accounts for `--` comments and nested `/- ... -/` comments.

It fails closed on an import form it cannot classify, an import after ordinary
commands have begun, `prelude`, a duplicate role, or a local import into a
different logical unit. If a source later gains such syntax, extend the parser
with a fixture before accepting it. Silently emitting a plausible but different
Lean program is worse than stopping regeneration.

## Discovery

Within every configured source root, immediate child files must either match

```text
<unit>.(types|spec|def|proof|props).lean
```

or be explicitly ignored in `config/sources.json`. An unexpected `.lean` file
is an error. This gives automatic discovery of newly generated units without
letting unrelated Lean experiments silently enter the corpus.

Files are grouped by configured output group and `<unit>`. Duplicate unit names
within a group, duplicate roles, path traversal, case-insensitive output
collisions, and two inputs mapping to the same output are errors.

Cross-group duplicate unit names are allowed because generated module names
carry their group prefix, for example `Corpus.Core.foo` and
`Corpus.NodeCasbin.foo`.

## Repository layout

```text
lemmascript-velvet-corpus/
  DESIGN.md
  README.md
  LICENSE

  package.json
  package-lock.json
  tsconfig.json
  config/
    sources.json                 # hand-maintained gathering policy
  bin/
    gather.ts
    check-artifacts.ts
    profile.ts                   # performance harness; may follow gathering v1
  src/
    config.ts
    discover.ts
    lean-header.ts
    emit.ts
  test/
    lean-header.test.ts
    gather.test.ts

  LemmaScript.lean               # generated support snapshot
  LemmaScript/                   # generated support snapshot
  Corpus/
    Core/*.lean                  # generated, one file per logical unit
    ClearSplit/*.lean
    ColorWheel/*.lean
    NodeCasbin/*.lean
    Pi/*.lean
    ATTRIBUTION.md               # generated source/license attribution
  LICENSES/                      # generated copies of source licenses
  metadata.json                  # generated provenance and artifact index

  lean-toolchain
  lakefile.lean
  lake-manifest.json
```

`Corpus/`, `LemmaScript.lean`, `LemmaScript/`, `LICENSES/`, and `metadata.json`
are generated artifacts and are never edited by hand.
`config/sources.json` is the source of gathering policy. The Lake files and
toolchain pin are maintained normally rather than rewritten by the gatherer.

The generated `Corpus.<Group>.<unit>` module prefixes let the Lake configuration
use stable globs. Adding a unit does not require editing a root list in
`lakefile.lean`.

## TypeScript gatherer

The gatherer is TypeScript run through `tsx`, matching the conventions of
`lemmascript-dafny-benchmark` and LemmaScript's own tooling. It uses only Node's
standard library at runtime. Development dependencies are limited initially to
`typescript`, `tsx`, and `@types/node`, with a committed npm lockfile.

This is preferable to Python here because:

- contributors already working on LemmaScript have the Node/TypeScript
  toolchain;
- path handling, hashing, JSON configuration, and subprocess metadata can
  share patterns with `lemmascript-dafny-benchmark`;
- fixtures exercise the actual gatherer without introducing another language
  environment; and
- it makes the distinction clear: application TypeScript is not corpus input,
  while TypeScript is entirely reasonable implementation language for corpus
  tooling.

Expected commands are:

```sh
npm run gather                    # rebuild generated artifacts from siblings
npm run gather -- --check         # compare only; write nothing
npm run check-artifacts           # internal checks; no siblings or Lean needed
npm run typecheck
npm test
```

`--parent-dir PATH` may override the configured `..` for an unusual checkout
layout. Absolute paths are used only during the run and never emitted.

There is no cloning mode. There is also no partial write mode: a partial walk
cannot determine which unseen outputs are stale. A future diagnostic `--only`
may inspect a unit, but it must be rejected when emission is requested.

### Reentrancy and writes

Gathering constructs the complete managed artifact set in a temporary
directory, validates it, then reconciles it with the repository. If discovery
or transformation fails, the repository is unchanged.

Inputs, cases, components, and JSON keys have deterministic ordering. Generated
artifacts contain no current timestamp. Running the gatherer twice against the
same consumed bytes and observed Git provenance produces byte-identical output
and no Git diff. Generated Lean remains byte-identical whenever its consumed
bytes are unchanged, even if unrelated Git provenance moves.

Stale generated cases are removed during a normal full gather. Unlike the Dafny
benchmark, this corpus has semantic path IDs rather than published numeric task
IDs, so it needs neither tombstones nor `--update`/`--prune` gates. Git diff is
the review boundary for a changed snapshot.

Deletion and replacement are restricted to declared managed paths. The
gatherer refuses to overwrite or remove an unrecognized file under a managed
directory unless it carries the generated marker or is listed in the previous
metadata. This protects an accidentally misplaced handwritten file.

## Generated metadata

`metadata.json` is both provenance and the artifact index. It has a schema
version and contains:

- the Lean toolchain string;
- each configured source's repository, expected branch, observed checkout
  branch and HEAD, relevant dirty state, and license;
- every copied support module and its source and output facts;
- every case's stable ID, module name, output path, group, and kind
  (`proof`, `properties`, or `elaboration`);
- ordered component records with role, repository-relative path, and file
  facts;
- the retained external imports; and
- SHA-256, bytes, and lines for the emitted module.

The stable case ID is `<group>/<unit>`, such as `core/binarySearch`. There are no
numeric IDs: readable identity is useful to a developer, and removing one case
must not renumber anything else.

`Corpus/ATTRIBUTION.md` is generated from the same source configuration, and
each configured `licenseFile` is copied to `LICENSES/<source-id>.txt`. The
initial sources are MIT except Node Casbin, which is Apache-2.0. Source license
notices remain in component bodies when present; attribution is not a substitute
for them.

### Artifact checking

`npm run check-artifacts` is fast and self-contained. It does not need sibling
checkouts, Git history, Lean, solvers, or network access. It verifies at least:

- metadata schema and unique source/case/module/output identities;
- valid component ordering and roles;
- every metadata output exists and matches its recorded hash and size;
- every generated Lean/support file is represented in metadata;
- there are no unlisted generated `.lean` files;
- module names agree with output paths;
- every synthesized case has its generated marker;
- every represented source has attribution and a byte-matching copied license;
- metadata's aggregate counts agree with its entries.

This establishes internal coherence. `npm run gather -- --check`, which does
require the siblings, additionally establishes that committed artifacts equal
what the current inputs generate. `lake build` establishes that the snapshot
elaborates with the selected engine. These are three separate checks.

## Lake workspace

There is one Lake workspace and several named libraries, all default targets:

```text
LemmaScriptSupport
CorpusCore
CorpusClearSplit
CorpusColorWheel
CorpusNodeCasbin
CorpusPi
CompatibilityTests
```

Each corpus library uses a module-prefix glob such as:

```lean
Glob.submodules `Corpus.Core
```

Thus generated case discovery and Lake discovery cannot drift through a
handwritten root array. Useful commands include:

```sh
lake build
lake build CorpusColorWheel
lake build CorpusNodeCasbin
```

`CompatibilityTests` contains a small handwritten check that a Velvet
obligation created in one anonymous section remains available to a
`prove_correct` command in the next. This directly tests the scoping assumption
used when combining components.

The repository pins one Lean toolchain, initially Lean 4.24.0, and commits
`lake-manifest.json`. Because corpus files directly import Mathlib, the root
package should declare and pin Mathlib rather than depend accidentally on it
remaining transitive through Velvet.

Solver installation is centralized once in the root workspace, using the
versions exercised by the current projects (Z3 4.15.4 and cvc5 1.3.1). The
five copied source projects' lakefiles and repeated solver-download code are
not copied.

### Velvet and Loom are variables, not corpus contents

The corpus does not vendor Velvet or Loom. Its initial Lake configuration uses
the sibling development checkouts so a Velvet developer can measure an edited
working tree immediately. The README records the exact pair used for the
reference validation. A developer can substitute either package without
editing committed files through Lake package overrides and a temporary JSON
file. Once Velvet's package declaration has a portable Loom dependency, the
default manifest can become an exact Git pin while retaining these local
overrides.

Combining each logical unit removes the need for the custom Velvet change that
persists obligations across imported `.def.lean` and `.proof.lean` modules. It
does not prove that every case works with stock Velvet and Loom. The current
LemmaScript stack also contains changes for `for ... in ...` preprocessing and
bounded range-loop hypotheses, and some cases may depend on them.

Therefore the initial compatibility pass is:

1. gather the normalized corpus;
2. build every case with the known-good custom pair;
3. build it again with the Velvet designer's current upstream/local pair; and
4. record which remaining failures are actual feature dependencies.

Initially, the reference pin may need the custom pair. It should move to
upstream revisions when those remaining dependencies land. The current custom
Velvet lakefile itself uses a sibling Loom path, so it needs a small packaging
commit that pins a portable Loom Git revision before it can serve as the
fresh-clone reference dependency.

## Profiling

The corpus's first job is to make reproducers easy, not to publish a leaderboard.
A profiling command should eventually support:

```sh
npm run profile -- core/binarySearch
npm run profile -- colorwheel/colorwheel --velvet ../velvet
npm run profile -- pi/compaction --velvet ../velvet --loom ../loom
```

For a case run it should:

1. prepare/build dependencies outside the timed interval;
2. invoke `lake env lean` on the single combined module;
3. enable Lean's structured profiler and retain its JSON output;
4. record wall time, maximum resident memory when available, platform,
   toolchain, corpus commit, and actual Velvet/Loom revisions; and
5. write results beneath a Git-ignored `results/` directory.

The wall time is full case elaboration: types, specifications, method
elaboration, and proof commands. That matches Velvet's same-file interface.
Lean's structured trace is the way to locate time inside individual
`prove_correct` commands; the design must not label whole-process time as
"proof time" without that distinction.

Dependency downloads and Mathlib compilation are setup costs, not Velvet case
measurements. A separate explicit cold-build mode may be useful, but it must
not be confused with the default warm-dependency profile.

No performance result is committed by default. Reference profiles are useful
only when their machine and engine metadata travel with them, and a result
format should be chosen after the Velvet designer has used the corpus on real
issues.

## Inclusion and failure policy

The gatherer includes every valid logical unit found in configured roots. It
does not filter for proof completeness, speed, or whether the reference engine
currently succeeds. A slow or failing real case can be the most useful member
of a performance corpus.

In particular, the existing admitted `adjustColorCommutes` theorem in
ColorWheel remains unchanged and is documented rather than filtered. This is
not a proof-soundness benchmark, and the gatherer must not silently improve or
delete source commands.

Build status and known issues should be reported separately from gathering.
The generated snapshot answers "what Lean workload did the configured sources
contain?"; a build answers "what did this Velvet/Loom pair do with it?"

## Tests and acceptance criteria

The TypeScript fixture suite covers at least:

- every component-role combination present in the initial corpus;
- import hoisting and stable deduplication;
- quoted dotted module identifiers;
- line and nested block comments around imports;
- source with and without a trailing newline;
- generated component sections and isolation of scoped state;
- duplicate roles and output collisions;
- unexpected Lean files;
- unsupported or late imports;
- cross-unit imports;
- stale generated-file removal; and
- byte-identical second generation.

The first implementation is complete when all of the following hold:

```sh
npm ci
npm run typecheck
npm test
npm run gather
npm run gather -- --check
npm run check-artifacts
lake build
```

The first `gather` must create the initial corpus. There is no manual copy whose
rules exist only in commit history.

## Settled decisions

- The name is `lemmascript-velvet-corpus`.
- The repository is a performance/reproducer corpus, not an agentic benchmark.
- Corpus inputs are Lean artifacts, not application TypeScript.
- The gatherer and supporting repository tools are TypeScript.
- Source checkouts are siblings and are never mutated by gathering.
- Generated artifacts are committed and reproducible.
- Each logical unit becomes one combined Lean module.
- Case-study application trees are flattened to one directory per corpus group.
- LemmaScript support modules retain their import-compatible layout.
- One Lake workspace provides group targets and shared dependencies.
- Velvet and Loom remain replaceable dependencies.

## Deferred

- The durable performance-result schema and any comparison UI.
- Whether reference profiles should ever be committed.
- Machine-independent resource metrics beyond Lean's profiler data.
- The exact upstream Velvet/Loom revision that builds the complete normalized
  corpus; the initial compatibility pass determines this.
- Automatically reseeding source repositories from LemmaScript CI. Manual,
  reviewable configuration is sufficient until the source set becomes costly
  to maintain.
