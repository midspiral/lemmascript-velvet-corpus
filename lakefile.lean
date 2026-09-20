import Lake
open Lake DSL

-- The reference setup uses the sibling LemmaScript development checkouts.
-- `.lake/package-overrides.json` or Lake's `--packages` option can substitute
-- another Velvet checkout without modifying this file.
require "leanprover-community" / "mathlib" @ git "v4.34.0"
require velvet from ".." / "velvet"

package LemmaScriptVelvetCorpus where
  leanOptions := #[⟨`pp.unicode.fun, true⟩]

@[default_target]
lean_lib LemmaScriptSupport where
  roots := #[`LemmaScript]

@[default_target]
lean_lib CorpusCore where
  globs := #[Glob.submodules `Corpus.Core]

@[default_target]
lean_lib CorpusClearSplit where
  globs := #[Glob.submodules `Corpus.ClearSplit]

@[default_target]
lean_lib CorpusColorWheel where
  globs := #[Glob.submodules `Corpus.ColorWheel]

@[default_target]
lean_lib CorpusNodeCasbin where
  globs := #[Glob.submodules `Corpus.NodeCasbin]

@[default_target]
lean_lib CorpusPi where
  globs := #[Glob.submodules `Corpus.Pi]

@[default_target]
lean_lib CompatibilityTests where
  globs := #[Glob.submodules `Compatibility]

