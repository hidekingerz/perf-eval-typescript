import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const RESULTS_DIR = join(ROOT, "results");

interface Run {
  version: string;
  size: "small" | "medium" | "large";
  mode: "typecheck" | "build";
  iterations: number;
  warmup: number;
  medianMs: number | null;
  p95Ms: number | null;
  peakRssKb: number | null;
  ok: boolean;
  error?: string;
}

interface DiffEntry {
  pair: string;
  size: "small" | "medium" | "large";
  identical: boolean;
  diffLines: number;
}

interface Raw {
  ts: string;
  env: Record<string, unknown>;
  runs: Run[];
  emit_diff?: DiffEntry[];
}

function findLatestResultsDir(): string {
  const latest = join(RESULTS_DIR, "latest");
  if (existsSync(latest)) return latest;
  const entries = readdirSync(RESULTS_DIR)
    .map((n) => join(RESULTS_DIR, n))
    .filter((p) => statSync(p).isDirectory())
    .sort();
  if (entries.length === 0) throw new Error("no results to report on");
  return entries[entries.length - 1];
}

function fmtMs(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${v.toFixed(0)}ms`;
}

function fmtRss(kb: number | null): string {
  if (kb == null) return "—";
  return `${(kb / 1024).toFixed(1)}MiB`;
}

function shortError(err: string | undefined): string {
  if (!err) return "no detail";
  if (err.includes("marked unavailable")) return "package unavailable";
  if (err.includes("missing")) return "fixtures missing";
  if (err.includes("not found")) return "compiler not installed";
  return err.split("\n")[0].slice(0, 60);
}

function buildTable(runs: Run[], mode: "typecheck" | "build"): string {
  const versions = ["ts6", "ts7", "ts8"];
  const sizes: Array<"small" | "medium" | "large"> = ["small", "medium", "large"];
  const lines: string[] = [];
  lines.push(`### ${mode === "typecheck" ? "型チェック (--noEmit)" : "ビルド (emit あり)"}`);
  lines.push("");
  lines.push("| version | size | median | p95 | peak RSS | status |");
  lines.push("|---|---|---:|---:|---:|---|");
  for (const v of versions) {
    for (const s of sizes) {
      const r = runs.find((x) => x.version === v && x.size === s && x.mode === mode);
      if (!r) {
        lines.push(`| ${v} | ${s} | — | — | — | (no run) |`);
        continue;
      }
      const status = r.ok ? "OK" : `skipped (${shortError(r.error)})`;
      lines.push(`| ${v} | ${s} | ${fmtMs(r.medianMs)} | ${fmtMs(r.p95Ms)} | ${fmtRss(r.peakRssKb)} | ${status} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function buildDiffTable(diffs: DiffEntry[] | undefined): string {
  if (!diffs || diffs.length === 0) {
    return "### emit 差分\n\n(emit 比較が実行されていません。`npm run diff` を先に実行してください。)\n";
  }
  const sizes = ["small", "medium", "large"];
  const pairs = Array.from(new Set(diffs.map((d) => d.pair)));
  const lines: string[] = [];
  lines.push("### emit 差分（正規化後の `diff -ruN` で算出）");
  lines.push("");
  lines.push("| pair | " + sizes.join(" | ") + " |");
  lines.push("|---" + sizes.map(() => "|---:").join("") + "|");
  for (const pair of pairs) {
    const cells = sizes.map((s) => {
      const e = diffs.find((d) => d.pair === pair && d.size === s);
      if (!e) return "—";
      if (e.identical) return "**identical**";
      if (e.diffLines < 0) return "(error)";
      return `${e.diffLines} lines`;
    });
    lines.push(`| ${pair} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const dir = findLatestResultsDir();
  const rawPath = join(dir, "raw.json");
  if (!existsSync(rawPath)) {
    process.stderr.write(`raw.json not found in ${dir} — run "npm run bench" first\n`);
    process.exit(1);
  }
  const raw: Raw = JSON.parse(readFileSync(rawPath, "utf8"));

  const md: string[] = [];
  md.push(`# perf-eval-ts8 レポート`);
  md.push("");
  md.push(`- 計測時刻: \`${raw.ts}\``);
  md.push(`- Node: \`${(raw.env as { node?: string }).node ?? "?"}\``);
  md.push(`- Platform: \`${(raw.env as { platform?: string }).platform ?? "?"}\``);
  md.push(`- 反復: warmup=${(raw.env as { warmup?: number }).warmup ?? "?"} measure=${(raw.env as { iterations?: number }).iterations ?? "?"}`);
  md.push("");
  md.push("## 速度・メモリ");
  md.push("");
  md.push(buildTable(raw.runs, "typecheck"));
  md.push(buildTable(raw.runs, "build"));
  md.push("## 出力 JS の差分");
  md.push("");
  md.push(buildDiffTable(raw.emit_diff));
  md.push("---");
  md.push("");
  md.push("生 JSON: `raw.json` / 各 diff のパッチ: `diff/<size>/<pair>.patch`");
  md.push("");

  const outPath = join(dir, "summary.md");
  writeFileSync(outPath, md.join("\n"), "utf8");
  process.stdout.write(`Wrote ${outPath}\n`);
}

main();
