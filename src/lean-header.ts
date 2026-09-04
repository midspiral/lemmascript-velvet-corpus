import { normalizeLf } from "./files.js";

export interface LeanImport {
  raw: string;
  module: string;
}

export interface LeanHeader {
  imports: LeanImport[];
  body: string;
}

interface ScanState {
  blockDepth: number;
}

function codeOutsideComments(line: string, state: ScanState): { code: string; hadComment: boolean } {
  let output = "";
  let hadComment = state.blockDepth > 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    const next = line[index + 1];
    if (state.blockDepth > 0) {
      hadComment = true;
      if (current === "/" && next === "-") {
        state.blockDepth += 1;
        index += 1;
      } else if (current === "-" && next === "/") {
        state.blockDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
    } else if (current === "-" && next === "-") {
      hadComment = true;
      break;
    } else if (current === "/" && next === "-") {
      hadComment = true;
      state.blockDepth += 1;
      index += 1;
    } else {
      output += current;
    }
  }
  return { code: output, hadComment };
}

export function normalizeLeanModule(raw: string): string {
  if (raw.startsWith("«") || raw.endsWith("»")) {
    if (!(raw.startsWith("«") && raw.endsWith("»")) || raw.length < 3) {
      throw new Error(`malformed quoted Lean module: ${raw}`);
    }
    return raw.slice(1, -1);
  }
  return raw;
}

export function parseLeanHeader(input: string, label = "Lean source"): LeanHeader {
  const text = normalizeLf(input).replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  const state: ScanState = { blockDepth: 0 };
  const imports: LeanImport[] = [];
  const bodyLines: string[] = [];
  let bodyStarted = false;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const beforeDepth = state.blockDepth;
    const { code, hadComment } = codeOutsideComments(line, state);
    const trimmed = code.trim();
    const where = `${label}:${lineNumber + 1}`;

    if (/^prelude(?:\s|$)/.test(trimmed)) {
      throw new Error(`${where}: prelude is not supported`);
    }
    if (/^import(?:\s|$)/.test(trimmed)) {
      if (bodyStarted) throw new Error(`${where}: import appears after an ordinary command`);
      if (beforeDepth !== 0 || state.blockDepth !== 0 || hadComment) {
        throw new Error(`${where}: comments on an import line are not supported`);
      }
      const match = /^import\s+(\S+)\s*$/.exec(trimmed);
      if (!match) throw new Error(`${where}: only one-line 'import <module>' commands are supported`);
      const raw = match[1];
      const module = normalizeLeanModule(raw);
      if (/\s/.test(module) || module.length === 0) throw new Error(`${where}: unsupported module name: ${raw}`);
      imports.push({ raw, module });
      continue;
    }
    if (/^(?:public\s+|private\s+|protected\s+)?import(?:\s|$)/.test(trimmed)) {
      throw new Error(`${where}: unsupported import command`);
    }
    if (trimmed.length > 0) bodyStarted = true;
    bodyLines.push(line);
  }
  if (state.blockDepth !== 0) throw new Error(`${label}: unterminated block comment`);

  return { imports, body: bodyLines.join("\n") };
}
