import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type Size = "small" | "medium" | "large";
type Pair = [string, string];

const ROOT = resolve(__dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const RESULTS_DIR = join(ROOT, "results");
const SIZES: Size[] = ["small", "medium", "large"];

interface PackageMeta {
  dir: string;
  name: string;
  available: boolean;
}

function loadPackages(): PackageMeta[] {
  const out: PackageMeta[] = [];
  for (const name of ["ts6", "ts7", "ts8"]) {
    const dir = join(PACKAGES_DIR, name);
    const benchPath = join(dir, "bench.json");
    if (!existsSync(benchPath)) continue;
    const meta = JSON.parse(readFileSync(benchPath, "utf8")) as { available: boolean };
    out.push({ dir, name, available: meta.available });
  }
  return out;
}

function walk(dir: string): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) result.push(...walk(p));
    else result.push(p);
  }
  return result;
}

function normalize(content: string): string {
  return content
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\/\/# sourceMappingURL=/.test(line))
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "\n");
}

function writeNormalizedTree(srcDist: string, normalizedRoot: string): string[] {
  const files: string[] = [];
  for (const abs of walk(srcDist)) {
    if (!/\.(js|d\.ts)$/.test(abs)) continue;
    const rel = relative(srcDist, abs);
    const dst = join(normalizedRoot, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, normalize(readFileSync(abs, "utf8")), "utf8");
    files.push(rel);
  }
  return files.sort();
}

function diffDirs(a: string, b: string): { diffLines: number; identical: boolean; patch: string } {
  const r = spawnSync("diff", ["-ruN", a, b], { encoding: "utf8" });
  // diff exits 0 if identical, 1 if differ, >1 on error
  if (r.status === 0) {
    return { diffLines: 0, identical: true, patch: "" };
  }
  if (r.status === 1) {
    const patch = r.stdout ?? "";
    const diffLines = patch
      .split("\n")
      .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
      .length;
    return { diffLines, identical: false, patch };
  }
  return {
    diffLines: -1,
    identical: false,
    patch: `(diff command failed: status=${r.status} stderr=${r.stderr ?? ""})`,
  };
}

function pairs(names: string[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      out.push([names[i], names[j]]);
    }
  }
  return out;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function findLatestResultsDir(): string {
  const latest = join(RESULTS_DIR, "latest");
  if (existsSync(latest)) return latest;
  // fallback: pick newest dir
  const entries = readdirSync(RESULTS_DIR)
    .map((n) => join(RESULTS_DIR, n))
    .filter((p) => statSync(p).isDirectory())
    .sort();
  if (entries.length > 0) return entries[entries.length - 1];
  // create a fresh one
  const fresh = join(RESULTS_DIR, timestamp());
  mkdirSync(fresh, { recursive: true });
  return fresh;
}

function main(): void {
  const packages = loadPackages().filter((p) => p.available);
  if (packages.length < 2) {
    process.stderr.write("diff-emit: need at least 2 available packages to compare\n");
    process.exit(0);
  }

  const outDir = findLatestResultsDir();
  const normalizedRoot = join(outDir, "normalized");
  mkdirSync(normalizedRoot, { recursive: true });
  const diffRoot = join(outDir, "diff");
  mkdirSync(diffRoot, { recursive: true });

  // Step 1: normalize each version's dist for each size
  const normalizedDirs: Record<string, Record<Size, string | null>> = {};
  for (const pkg of packages) {
    normalizedDirs[pkg.name] = { small: null, medium: null, large: null };
    for (const size of SIZES) {
      const dist = join(pkg.dir, "dist", size);
      if (!existsSync(dist)) {
        process.stderr.write(`(skip) ${pkg.name}/${size}: dist missing — run "npm -w @bench/${pkg.name} run build:${size}" first\n`);
        continue;
      }
      const target = join(normalizedRoot, pkg.name, size);
      mkdirSync(target, { recursive: true });
      writeNormalizedTree(dist, target);
      normalizedDirs[pkg.name][size] = target;
    }
  }

  // Step 2: pairwise diff per size
  const summary: Array<{
    pair: string;
    size: Size;
    identical: boolean;
    diffLines: number;
  }> = [];

  for (const [a, b] of pairs(packages.map((p) => p.name))) {
    for (const size of SIZES) {
      const da = normalizedDirs[a]?.[size];
      const db = normalizedDirs[b]?.[size];
      if (!da || !db) continue;
      const { diffLines, identical, patch } = diffDirs(da, db);
      const patchDir = join(diffRoot, size);
      mkdirSync(patchDir, { recursive: true });
      const patchPath = join(patchDir, `${a}_vs_${b}.patch`);
      writeFileSync(patchPath, patch || "(identical)\n", "utf8");
      summary.push({ pair: `${a}_vs_${b}`, size, identical, diffLines });
      process.stdout.write(
        `  [${a} vs ${b} / ${size}] ${identical ? "IDENTICAL" : `diff_lines=${diffLines}`} -> ${patchPath}\n`,
      );
    }
  }

  // Merge into raw.json if present
  const rawPath = join(outDir, "raw.json");
  if (existsSync(rawPath)) {
    const raw = JSON.parse(readFileSync(rawPath, "utf8"));
    raw.emit_diff = summary;
    writeFileSync(rawPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
    process.stdout.write(`Updated ${rawPath} with emit_diff summary\n`);
  } else {
    writeFileSync(
      join(outDir, "emit_diff.json"),
      JSON.stringify({ emit_diff: summary }, null, 2) + "\n",
      "utf8",
    );
  }
}

main();
