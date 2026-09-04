import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLeanModule, parseLeanHeader } from "../src/lean-header.js";

test("extracts imports around line and nested block comments", () => {
  const source = [
    "-- copyright stays with the body",
    "/- outer /- nested -/ comment -/",
    "",
    "import LemmaScript",
    "import «binarySearch.types»",
    "",
    "def answer := 42",
    "",
  ].join("\n");
  const parsed = parseLeanHeader(source, "fixture.lean");
  assert.deepEqual(parsed.imports, [
    { raw: "LemmaScript", module: "LemmaScript" },
    { raw: "«binarySearch.types»", module: "binarySearch.types" },
  ]);
  assert.match(parsed.body, /copyright stays with the body/);
  assert.match(parsed.body, /nested/);
  assert.match(parsed.body, /def answer := 42\n$/);
  assert.doesNotMatch(parsed.body, /^import/m);
});

test("normalizes quoted dotted modules", () => {
  assert.equal(normalizeLeanModule("«compaction-cli.def»"), "compaction-cli.def");
  assert.equal(normalizeLeanModule("Mathlib.Tactic"), "Mathlib.Tactic");
});

test("normalizes CRLF and a missing trailing newline", () => {
  const parsed = parseLeanHeader("import Foo\r\n\r\ndef x := 1", "fixture.lean");
  assert.equal(parsed.body, "\ndef x := 1");
});

test("rejects late imports", () => {
  assert.throws(
    () => parseLeanHeader("def x := 1\nimport Foo\n", "late.lean"),
    /import appears after an ordinary command/,
  );
});

test("rejects unsupported imports, prelude, and unterminated comments", () => {
  assert.throws(() => parseLeanHeader("import Foo Bar\n"), /only one-line/);
  assert.throws(() => parseLeanHeader("import Foo -- why\n"), /comments on an import line/);
  assert.throws(() => parseLeanHeader("public import Foo\n"), /unsupported import command/);
  assert.throws(() => parseLeanHeader("prelude\n"), /prelude is not supported/);
  assert.throws(() => parseLeanHeader("/- unfinished\n"), /unterminated block comment/);
});
