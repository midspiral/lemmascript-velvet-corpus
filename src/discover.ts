import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentRole,
  CorpusConfig,
  DiscoveredCase,
  DiscoveredComponent,
} from "./types.js";
import { COMPONENT_ROLES } from "./types.js";
import { toPosix } from "./files.js";

const ROLE_INDEX = new Map<ComponentRole, number>(COMPONENT_ROLES.map((role, index) => [role, index]));
const COMPONENT_PATTERN = /^(.+)\.(types|spec|def|proof|props)\.lean$/;

export interface DiscoveryResult {
  cases: DiscoveredCase[];
  localModules: Set<string>;
}

export async function discoverCases(config: CorpusConfig, parentDir: string): Promise<DiscoveryResult> {
  const casesById = new Map<string, DiscoveredCase>();
  const caseRoots = new Map<string, string>();
  const outputNames = new Set<string>();
  const localModules = new Set<string>();

  for (const source of config.sources) {
    const checkoutRoot = path.join(parentDir, source.checkout);
    const checkoutInfo = await stat(checkoutRoot).catch(() => null);
    if (!checkoutInfo?.isDirectory()) throw new Error(`source checkout is missing: ${checkoutRoot}`);

    for (const group of source.groups) {
      for (const root of group.roots) {
        const absoluteRoot = path.join(checkoutRoot, root);
        let entries;
        try {
          entries = await readdir(absoluteRoot, { withFileTypes: true });
        } catch (error) {
          throw new Error(`cannot read source root ${absoluteRoot}: ${error instanceof Error ? error.message : String(error)}`);
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
          if (!entry.name.endsWith(".lean")) continue;
          if (!entry.isFile()) throw new Error(`${source.id}/${toPosix(path.join(root, entry.name))}: Lean input is not a regular file`);
          const sourcePath = toPosix(path.join(root, entry.name));
          if (group.ignore.includes(entry.name) || group.ignore.includes(sourcePath)) continue;
          const match = COMPONENT_PATTERN.exec(entry.name);
          if (!match) {
            throw new Error(`${source.id}/${sourcePath}: unexpected Lean file; configure it in ignore or use <unit>.<role>.lean`);
          }
          const [, unit, rawRole] = match;
          if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(unit) || unit.includes("..")) {
            throw new Error(`${source.id}/${sourcePath}: unsafe logical unit name: ${unit}`);
          }
          const role = rawRole as ComponentRole;
          const id = `${group.id}/${unit}`;
          const outputKey = `${group.module}/${unit}`.toLowerCase();
          let discovered = casesById.get(id);
          if (!discovered) {
            if (outputNames.has(outputKey)) throw new Error(`case-insensitive output collision at Corpus/${group.module}/${unit}.lean`);
            outputNames.add(outputKey);
            discovered = {
              id,
              unit,
              groupId: group.id,
              groupModule: group.module,
              sourceId: source.id,
              checkout: source.checkout,
              components: [],
            };
            casesById.set(id, discovered);
            caseRoots.set(id, `${source.id}/${root}`);
          } else if (discovered.sourceId !== source.id || discovered.groupModule !== group.module) {
            throw new Error(`duplicate case id across configured roots: ${id}`);
          }
          if (discovered.components.some((component) => component.role === role)) {
            throw new Error(`${id}: duplicate ${role} component`);
          }
          if (caseRoots.get(id) !== `${source.id}/${root}`) {
            throw new Error(`${id}: duplicate logical unit across configured roots`);
          }
          const component: DiscoveredComponent = {
            role,
            absolutePath: path.join(absoluteRoot, entry.name),
            sourcePath,
          };
          discovered.components.push(component);
          localModules.add(`${unit}.${role}`);
        }
      }
    }
  }

  const cases = [...casesById.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
  for (const discovered of cases) {
    discovered.components.sort((a, b) => ROLE_INDEX.get(a.role)! - ROLE_INDEX.get(b.role)!);
    if (!discovered.components.some((component) => component.role === "def")) {
      throw new Error(`${discovered.id}: logical unit has no .def.lean component`);
    }
  }
  return { cases, localModules };
}
