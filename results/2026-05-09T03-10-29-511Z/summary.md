# perf-eval-ts8 レポート

- 計測時刻: `2026-05-09T03-10-29-511Z`
- Node: `v22.22.2`
- Platform: `linux-x64`
- 反復: warmup=1 measure=5

## 速度・メモリ

### 型チェック (--noEmit)

| version | size | median | p95 | peak RSS | status |
|---|---|---:|---:|---:|---|
| ts6 | small | 488ms | 554ms | 109.1MiB | OK |
| ts6 | medium | 1.28s | 1.35s | 156.2MiB | OK |
| ts6 | large | 6.90s | 7.08s | 562.7MiB | OK |
| ts7 | small | 97ms | 109ms | 37.1MiB | OK |
| ts7 | medium | 211ms | 218ms | 57.8MiB | OK |
| ts7 | large | 1.70s | 1.77s | 438.1MiB | OK |
| ts8 | small | — | — | — | skipped (package unavailable) |
| ts8 | medium | — | — | — | skipped (package unavailable) |
| ts8 | large | — | — | — | skipped (package unavailable) |

### ビルド (emit あり)

| version | size | median | p95 | peak RSS | status |
|---|---|---:|---:|---:|---|
| ts6 | small | 497ms | 508ms | 109.9MiB | OK |
| ts6 | medium | 1.47s | 1.57s | 163.6MiB | OK |
| ts6 | large | 9.65s | 10.13s | 635.2MiB | OK |
| ts7 | small | 110ms | 115ms | 35.5MiB | OK |
| ts7 | medium | 291ms | 375ms | 62.5MiB | OK |
| ts7 | large | 2.74s | 2.86s | 529.7MiB | OK |
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
