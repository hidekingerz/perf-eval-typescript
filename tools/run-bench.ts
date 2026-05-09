import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

type Mode = "typecheck" | "build";
type Size = "small" | "medium" | "large";

interface PackageMeta {
  dir: string;
  name: string;
  label: string;
  compilerBin: string;
  available: boolean;
  note: string;
}

interface RunResult {
  version: string;
  size: Size;
  mode: Mode;
  iterations: number;
  warmup: number;
  durationsMs: number[];
  medianMs: number | null;
  p95Ms: number | null;
  peakRssKb: number | null;
  rssSampler: "proc" | "gnu-time" | "none";
  exitCodes: number[];
  ok: boolean;
  error?: string;
}

const ROOT = resolve(__dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const RESULTS_DIR = join(ROOT, "results");
const SIZES: Size[] = ["small", "medium", "large"];
const MODES: Mode[] = ["typecheck", "build"];

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 5);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 1);
const SAMPLE_INTERVAL_MS = Number(process.env.BENCH_RSS_INTERVAL_MS ?? 25);

function loadPackages(): PackageMeta[] {
  const out: PackageMeta[] = [];
  for (const name of ["ts6", "ts7", "ts8"]) {
    const dir = join(PACKAGES_DIR, name);
    const benchPath = join(dir, "bench.json");
    if (!existsSync(benchPath)) continue;
    const meta = JSON.parse(readFileSync(benchPath, "utf8")) as {
      label: string;
      compilerBin: string;
      available: boolean;
      note?: string;
    };
    out.push({
      dir,
      name,
      label: meta.label,
      compilerBin: meta.compilerBin,
      available: meta.available,
      note: meta.note ?? "",
    });
  }
  return out;
}

function resolveBin(pkg: PackageMeta): string | null {
  // Prefer node_modules/.bin/<compilerBin> inside the package.
  const local = join(pkg.dir, "node_modules", ".bin", pkg.compilerBin);
  if (existsSync(local)) return local;
  // Fall back to root node_modules/.bin
  const rootLocal = join(ROOT, "node_modules", ".bin", pkg.compilerBin);
  if (existsSync(rootLocal)) return rootLocal;
  return null;
}

function fixtureExists(size: Size): boolean {
  return existsSync(join(ROOT, "fixtures", size, "src"));
}

function rmDist(pkg: PackageMeta, size: Size): void {
  const dist = join(pkg.dir, "dist", size);
  if (existsSync(dist)) {
    try {
      const { rmSync } = require("node:fs");
      rmSync(dist, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

interface OneRunOutcome {
  durationMs: number;
  exitCode: number;
  peakRssKb: number;
}

function readVmHWMKb(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const m = status.match(/VmHWM:\s+(\d+)\s+kB/);
    if (!m) return null;
    return Number(m[1]);
  } catch {
    return null;
  }
}

async function runOnce(
  bin: string,
  args: string[],
  cwd: string,
): Promise<OneRunOutcome> {
  return new Promise((resolveOnce) => {
    const start = performance.now();
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    let peakRssKb = 0;
    const sampler = setInterval(() => {
      const v = readVmHWMKb(child.pid ?? -1);
      if (v != null && v > peakRssKb) peakRssKb = v;
    }, SAMPLE_INTERVAL_MS);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearInterval(sampler);
      const durationMs = performance.now() - start;
      if (code !== 0 && stderr.trim().length > 0) {
        process.stderr.write(`    [stderr] ${stderr.trim().split("\n").slice(0, 5).join("\n    ")}\n`);
      }
      resolveOnce({
        durationMs,
        exitCode: code ?? -1,
        peakRssKb,
      });
    });
    child.on("error", (err) => {
      clearInterval(sampler);
      const durationMs = performance.now() - start;
      process.stderr.write(`    [spawn-error] ${err.message}\n`);
      resolveOnce({ durationMs, exitCode: -1, peakRssKb: 0 });
    });
  });
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

async function benchOne(
  pkg: PackageMeta,
  size: Size,
  mode: Mode,
): Promise<RunResult> {
  const result: RunResult = {
    version: pkg.name,
    size,
    mode,
    iterations: ITERATIONS,
    warmup: WARMUP,
    durationsMs: [],
    medianMs: null,
    p95Ms: null,
    peakRssKb: null,
    rssSampler: "proc",
    exitCodes: [],
    ok: false,
  };

  if (!pkg.available) {
    result.error = `package ${pkg.name} marked unavailable in bench.json (${pkg.note})`;
    return result;
  }
  if (!fixtureExists(size)) {
    result.error = `fixtures/${size}/src missing — run "npm run gen:${size}" first`;
    return result;
  }
  const bin = resolveBin(pkg);
  if (!bin) {
    result.error = `compiler binary "${pkg.compilerBin}" not found in node_modules/.bin — run "npm install" first`;
    return result;
  }

  const tsconfig = `tsconfig.${size}.json`;
  const args = mode === "typecheck"
    ? ["-p", tsconfig, "--noEmit"]
    : ["-p", tsconfig];

  process.stdout.write(`  [${pkg.name}/${size}/${mode}] warmup x${WARMUP} + measure x${ITERATIONS}\n`);

  const peaks: number[] = [];
  for (let i = 0; i < WARMUP; i++) {
    if (mode === "build") rmDist(pkg, size);
    const r = await runOnce(bin, args, pkg.dir);
    if (r.exitCode !== 0) {
      result.error = `warmup exited with code ${r.exitCode}`;
      result.exitCodes.push(r.exitCode);
      return result;
    }
  }
  for (let i = 0; i < ITERATIONS; i++) {
    if (mode === "build") rmDist(pkg, size);
    const r = await runOnce(bin, args, pkg.dir);
    result.durationsMs.push(r.durationMs);
    result.exitCodes.push(r.exitCode);
    if (r.peakRssKb > 0) peaks.push(r.peakRssKb);
    if (r.exitCode !== 0) {
      result.error = `iteration ${i} exited with code ${r.exitCode}`;
      return result;
    }
  }

  result.medianMs = median(result.durationsMs);
  result.p95Ms = percentile(result.durationsMs, 95);
  result.peakRssKb = peaks.length > 0 ? Math.max(...peaks) : null;
  result.ok = true;
  return result;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const packages = loadPackages();
  const ts = timestamp();
  const outDir = join(RESULTS_DIR, ts);
  mkdirSync(outDir, { recursive: true });

  const env = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    iterations: ITERATIONS,
    warmup: WARMUP,
    rssSamplerIntervalMs: SAMPLE_INTERVAL_MS,
    cpuModel: process.versions,
  };

  const runs: RunResult[] = [];
  for (const pkg of packages) {
    process.stdout.write(`\n=== ${pkg.label} (${pkg.name}) ===\n`);
    if (!pkg.available) {
      process.stdout.write(`  unavailable: ${pkg.note}\n`);
    }
    for (const size of SIZES) {
      for (const mode of MODES) {
        const r = await benchOne(pkg, size, mode);
        if (r.ok) {
          process.stdout.write(
            `    OK median=${r.medianMs?.toFixed(1)}ms p95=${r.p95Ms?.toFixed(1)}ms peakRss=${r.peakRssKb ?? "?"}KB\n`,
          );
        } else {
          process.stdout.write(`    SKIP/FAIL: ${r.error}\n`);
        }
        runs.push(r);
      }
    }
  }

  const raw = { ts, env, runs };
  writeFileSync(join(outDir, "raw.json"), JSON.stringify(raw, null, 2) + "\n", "utf8");

  // update results/latest symlink
  const latest = join(RESULTS_DIR, "latest");
  try {
    const { symlinkSync, unlinkSync, statSync } = require("node:fs");
    try { unlinkSync(latest); } catch { /* not exist */ }
    symlinkSync(ts, latest);
  } catch (err) {
    process.stderr.write(`(warning) could not update results/latest symlink: ${(err as Error).message}\n`);
  }

  process.stdout.write(`\nWrote ${join(outDir, "raw.json")}\n`);
}

main().catch((err) => {
  process.stderr.write(`run-bench failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
