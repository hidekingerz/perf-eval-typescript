import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type SizeName = "small" | "medium" | "large";

interface SizeProfile {
  fileCount: number;
  fnPerFile: number;
  classPerFile: number;
  genericChainDepth: number;
  conditionalRatio: number;
  mappedRatio: number;
  importFanout: number;
}

const PROFILES: Record<SizeName, SizeProfile> = {
  small: {
    fileCount: 10,
    fnPerFile: 4,
    classPerFile: 1,
    genericChainDepth: 2,
    conditionalRatio: 0.2,
    mappedRatio: 0.2,
    importFanout: 2,
  },
  medium: {
    fileCount: 100,
    fnPerFile: 6,
    classPerFile: 2,
    genericChainDepth: 3,
    conditionalRatio: 0.3,
    mappedRatio: 0.3,
    importFanout: 3,
  },
  large: {
    fileCount: 1000,
    fnPerFile: 8,
    classPerFile: 2,
    genericChainDepth: 4,
    conditionalRatio: 0.4,
    mappedRatio: 0.4,
    importFanout: 4,
  },
};

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const PRIM_TYPES = ["string", "number", "boolean", "bigint"];

function genGenericChain(rng: () => number, depth: number): string {
  if (depth <= 0) return pick(rng, PRIM_TYPES);
  const inner = genGenericChain(rng, depth - 1);
  const wrappers = [
    `Array<${inner}>`,
    `Readonly<${inner}>`,
    `Partial<{ v: ${inner} }>`,
    `Map<string, ${inner}>`,
  ];
  return pick(rng, wrappers);
}

function genConditionalType(rng: () => number, name: string): string {
  return `export type ${name}<T> = T extends string\n  ? { kind: "s"; value: T }\n  : T extends number\n  ? { kind: "n"; value: T }\n  : T extends Array<infer U>\n  ? { kind: "a"; head: U }\n  : { kind: "o"; value: T };\n`;
}

function genMappedType(rng: () => number, name: string): string {
  return `export type ${name}<T> = { readonly [K in keyof T]-?: T[K] extends Function ? T[K] : Readonly<T[K]> };\n`;
}

function genFunction(
  rng: () => number,
  name: string,
  depth: number,
): string {
  const argT = genGenericChain(rng, depth);
  const retT = genGenericChain(rng, depth);
  return `export function ${name}<T extends ${argT}>(arg: T): ${retT} {\n  // synthetic body to give the type checker something to infer through\n  const tmp: T = arg;\n  return tmp as unknown as ${retT};\n}\n`;
}

function genClass(rng: () => number, name: string, depth: number): string {
  const fieldT = genGenericChain(rng, depth);
  return `export class ${name}<T extends ${fieldT}> {\n  constructor(public readonly value: T) {}\n  map<U>(f: (t: T) => U): ${name}<U extends ${fieldT} ? U : never> {\n    return new ${name}(f(this.value) as U & ${fieldT}) as never;\n  }\n}\n`;
}

function genFile(
  rng: () => number,
  index: number,
  total: number,
  profile: SizeProfile,
): string {
  const lines: string[] = [];
  // Imports: pull from a few neighbors to create a realistic graph
  const fanout = Math.min(profile.importFanout, Math.max(0, total - 1));
  const seen = new Set<number>();
  for (let i = 0; i < fanout; i++) {
    let target: number;
    let safety = 0;
    do {
      target = Math.floor(rng() * total);
      safety++;
    } while ((target === index || seen.has(target)) && safety < 8);
    if (target === index) continue;
    seen.add(target);
    lines.push(
      `import type { Cls_${target}_0 } from "./mod_${target}";`,
    );
  }
  if (lines.length > 0) lines.push("");

  // Functions
  for (let i = 0; i < profile.fnPerFile; i++) {
    lines.push(
      genFunction(rng, `fn_${index}_${i}`, profile.genericChainDepth),
    );
  }

  // Classes
  for (let i = 0; i < profile.classPerFile; i++) {
    lines.push(
      genClass(rng, `Cls_${index}_${i}`, profile.genericChainDepth),
    );
  }

  // Conditional types
  if (rng() < profile.conditionalRatio) {
    lines.push(genConditionalType(rng, `Cond_${index}`));
  }

  // Mapped types
  if (rng() < profile.mappedRatio) {
    lines.push(genMappedType(rng, `Mapped_${index}`));
  }

  // Force a usage of imported types so the import isn't elided (type-only ref)
  for (const target of seen) {
    lines.push(`export type _Ref_${index}_${target} = typeof Cls_${target}_0;`);
  }

  return lines.join("\n");
}

function parseArgs(argv: string[]): {
  size: SizeName;
  seed: number;
  outRoot: string;
} {
  let size: SizeName | null = null;
  let seed = 1;
  let outRoot = resolve(__dirname, "..", "fixtures");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--size") size = argv[++i] as SizeName;
    else if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--out") outRoot = resolve(argv[++i]);
  }
  if (!size || !(size in PROFILES)) {
    throw new Error("Usage: gen-fixtures --size {small|medium|large} [--seed N] [--out PATH]");
  }
  return { size, seed, outRoot };
}

function main(): void {
  const { size, seed, outRoot } = parseArgs(process.argv.slice(2));
  const profile = PROFILES[size];
  const rng = mulberry32(seed);

  const sizeDir = join(outRoot, size);
  const srcDir = join(sizeDir, "src");
  rmSync(srcDir, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });

  for (let i = 0; i < profile.fileCount; i++) {
    const content = genFile(rng, i, profile.fileCount, profile);
    writeFileSync(join(srcDir, `mod_${i}.ts`), content, "utf8");
  }

  // Entry file that re-exports everything to ensure all modules are reachable.
  const entryParts: string[] = [];
  for (let i = 0; i < profile.fileCount; i++) {
    entryParts.push(`export * from "./mod_${i}";`);
  }
  writeFileSync(join(srcDir, "index.ts"), entryParts.join("\n") + "\n", "utf8");

  const meta = {
    size,
    seed,
    profile,
    fileCount: profile.fileCount + 1,
    generatedAt: new Date().toISOString(),
    generator: "tools/gen-fixtures.ts",
  };
  writeFileSync(join(sizeDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

  process.stdout.write(
    `[gen-fixtures] size=${size} files=${profile.fileCount + 1} seed=${seed} -> ${srcDir}\n`,
  );
}

main();
