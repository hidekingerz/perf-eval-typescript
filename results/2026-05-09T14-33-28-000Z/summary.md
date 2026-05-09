# perf-eval-ts8 レポート

- 計測時刻: `2026-05-09T14-33-28-000Z`
- Node: `v24.15.0`
- Platform: `linux-x64`
- 反復: warmup=1 measure=5

## 速度・メモリ

### 型チェック (--noEmit)

| version | size | median | p95 | peak RSS | status |
|---|---|---:|---:|---:|---|
| ts6 | small | 381ms | 432ms | 113.6MiB | OK |
| ts6 | medium | 867ms | 1.40s | 199.6MiB | OK |
| ts6 | large | 4.94s | 5.13s | 725.6MiB | OK |
| ts7 | small | 70ms | 74ms | 46.0MiB | OK |
| ts7 | medium | 151ms | 155ms | 54.1MiB | OK |
| ts7 | large | 1.30s | 1.41s | 462.8MiB | OK |
| ts8 | small | — | — | — | skipped (package unavailable) |
| ts8 | medium | — | — | — | skipped (package unavailable) |
| ts8 | large | — | — | — | skipped (package unavailable) |

### ビルド (emit あり)

| version | size | median | p95 | peak RSS | status |
|---|---|---:|---:|---:|---|
| ts6 | small | 381ms | 404ms | 115.4MiB | OK |
| ts6 | medium | 1.00s | 1.06s | 206.3MiB | OK |
| ts6 | large | 6.51s | 6.67s | 803.4MiB | OK |
| ts7 | small | 69ms | 71ms | 47.5MiB | OK |
| ts7 | medium | 168ms | 172ms | 60.3MiB | OK |
| ts7 | large | 2.15s | 2.19s | 521.3MiB | OK |
| ts8 | small | — | — | — | skipped (package unavailable) |
| ts8 | medium | — | — | — | skipped (package unavailable) |
| ts8 | large | — | — | — | skipped (package unavailable) |

## 出力 JS の差分

### emit 差分（正規化後の `diff -ruN` で算出）

| pair | small | medium | large |
|---|---:|---:|---:|
| ts6_vs_ts7 | **identical** | **identical** | **identical** |

---

生 JSON: `raw.json` / 各 diff のパッチ: `diff/<size>/<pair>.patch`
