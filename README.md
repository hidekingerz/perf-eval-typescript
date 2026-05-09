# perf-eval-typescript

TypeScript 6 / 7 / 8 のコンパイラ実装の **コンパイル速度・型チェック速度・ピークメモリ・出力 JS の差分** を実測するためのベンチ環境です。

TypeScript 7 で公式コンパイラが Go に書き直された（`@typescript/native-preview` の `tsgo` バイナリとして配布）ため、JS 実装の TS6 と Go 実装の TS7 を同条件で比較できるよう、合成ベンチ（小・中・大）を 1 セットだけ生成し、各バージョンの workspace から共有参照する構成にしています。TS8 は本記事執筆時点（2026-05）で未公開のためプレースホルダです。

## 前提

- Linux (peak RSS は `/proc/<pid>/status` の `VmHWM` を 25ms 間隔でサンプリング)
- Node.js 20 以降
- npm 10 以降

## 構成

```
.
├── fixtures/                # 共有合成ベンチ入力 (生成物・git 管理外)
│   ├── small/  meta.json + src/ (~10 file)
│   ├── medium/ meta.json + src/ (~100 file)
│   └── large/  meta.json + src/ (~1000 file)
├── packages/
│   ├── ts6/   typescript@6           (CLI: tsc)
│   ├── ts7/   @typescript/native-preview (CLI: tsgo, Go 実装)
│   └── ts8/   placeholder            (typescript@8 が出たら devDependencies と bench.json を更新)
├── tools/
│   ├── gen-fixtures.ts  決定論的合成コードジェネレータ
│   ├── run-bench.ts     速度+メモリ計測オーケストレータ
│   ├── diff-emit.ts     emit を正規化してペア diff
│   └── report.ts        raw.json -> summary.md 整形
├── tsconfig.base.json   3 バージョン共通の compilerOptions
└── results/<timestamp>/ raw.json / summary.md / diff/<size>/<pair>.patch
```

## 使い方

```bash
npm run setup     # = npm install (workspaces 一括)
npm run gen       # 全サイズの fixtures 生成
npm run bench     # 全 (version × size × {typecheck,build}) を計測
npm run diff      # 各 dist を正規化して 3 ペア × 3 サイズで diff
npm run report    # results/<timestamp>/summary.md を生成
npm run all       # gen → bench → diff → report
```

サイズ単独実行:

```bash
npm run gen:small
npm -w @bench/ts6 run typecheck:small
npm -w @bench/ts7 run build:medium
```

環境変数で計測パラメータを調整:

```bash
BENCH_ITERATIONS=10 BENCH_WARMUP=2 npm run bench
BENCH_RSS_INTERVAL_MS=10 npm run bench   # よりこまかい RSS サンプリング
```

## TS8 を有効化する手順（typescript@8 が公開されたら）

1. `packages/ts8/package.json` の `devDependencies` に `"typescript": "8"` を追加
2. `packages/ts8/bench.json` の `available` を `true` に変更
3. `npm install`
4. `npm run all`

代替実装（例: 別の Go 実装パッケージや git tag 指定）を当てる場合は `compilerBin` も書き換えれば `run-bench.ts` がそれを使います。

## TS7 (Go 実装) について

- npm パッケージ名: `@typescript/native-preview`
- バイナリ: `tsgo`（CLI は `tsc -p tsconfig.json` `--noEmit` 等のサブセットを互換）
- プラットフォーム別バイナリ（例: `@typescript/native-preview-linux-x64`）が optionalDependencies で同梱

## 計測仕様

- **wall-clock**: `process.hrtime.bigint()` ベース、warmup 1 回 + 計測 5 回（`BENCH_*` で上書き可）、中央値と p95 を記録
- **peak RSS**: 子プロセス起動後 `/proc/<pid>/status` の `VmHWM` を 25ms 間隔でサンプリングし最大値を採用。Linux 専用
- **emit diff**: 正規化（バナー除去、`\r\n→\n`、BOM 除去、`//# sourceMappingURL=` 除去、trailing space 削除）後に `diff -ruN` を取り、追加/削除行数を集計

## 設計上の制約・注意

- emit が「意味的に同一だがフォーマットが違う」場合（identifier 並び、helper 展開順など）は diff 行数として現れます。完全な意味的同一性を担保したい場合は AST diff への拡張が必要
- `tsconfig.base.json` を 3 バージョンで完全一致させているため、TS のバージョン間で deprecated/新規追加された compilerOptions を使う実験は別途 tsconfig を切る必要があります
- fixtures は `meta.json` に記録された seed から再現されます。`src/` は git 管理外
