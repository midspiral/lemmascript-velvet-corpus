export const COMPONENT_ROLES = ["types", "spec", "def", "proof", "props"] as const;

export type ComponentRole = (typeof COMPONENT_ROLES)[number];

export interface GroupConfig {
  id: string;
  module: string;
  roots: string[];
  ignore: string[];
}

export interface SourceConfig {
  id: string;
  repo: string;
  checkout: string;
  branch: string;
  license: string;
  licenseFile: string;
  support: string[];
  groups: GroupConfig[];
}

export interface CorpusConfig {
  schemaVersion: 1;
  parentDir: string;
  sources: SourceConfig[];
}

export interface FileFacts {
  sha256: string;
  bytes: number;
  lines: number;
}

export interface PathFacts extends FileFacts {
  path: string;
}

export interface DiscoveredComponent {
  role: ComponentRole;
  absolutePath: string;
  sourcePath: string;
}

export interface DiscoveredCase {
  id: string;
  unit: string;
  groupId: string;
  groupModule: string;
  sourceId: string;
  checkout: string;
  components: DiscoveredComponent[];
}

export interface SourceMetadata {
  id: string;
  repository: string;
  checkout: string;
  expectedBranch: string;
  observedBranch: string | null;
  head: string | null;
  relevantDirty: boolean | null;
  branchMatches: boolean | null;
  license: {
    spdx: string;
    source: PathFacts;
    output: PathFacts;
  };
}

export interface SupportMetadata {
  sourceId: string;
  source: PathFacts;
  output: PathFacts;
}

export interface ComponentMetadata {
  role: ComponentRole;
  source: PathFacts;
}

export type CaseKind = "proof" | "properties" | "elaboration";

export interface CaseMetadata {
  id: string;
  unit: string;
  group: string;
  sourceId: string;
  module: string;
  kind: CaseKind;
  imports: string[];
  components: ComponentMetadata[];
  proveCorrectCommands: number;
  output: PathFacts;
}

export interface CorpusCounts {
  sources: number;
  supportFiles: number;
  cases: number;
  components: number;
  proofCases: number;
  propertyCases: number;
  elaborationCases: number;
  proveCorrectCommands: number;
}

export interface CorpusMetadata {
  schemaVersion: 1;
  generator: string;
  leanToolchain: string;
  counts: CorpusCounts;
  sources: SourceMetadata[];
  support: SupportMetadata[];
  cases: CaseMetadata[];
  attribution: PathFacts;
}

export interface Snapshot {
  files: Map<string, Buffer>;
  metadata: CorpusMetadata;
}

