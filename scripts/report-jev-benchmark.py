#!/usr/bin/env python3
"""Summarize saved successful JEV calls; no network or model calls."""
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
timeline = json.loads((ROOT / 'data/physician-tasks-100/jev-timeline.json').read_text())
results = [item['modes']['qa']['result'] for item in timeline['items']]
price = 0.04  # USD / 1M input tokens, checked 2026-09-28; see docs/速度与成本.md.
inputs = sum(row['usage']['inputTokens'] for row in results)
report = {'qa_count': len(results), 'requests': sum(row.get('requestCount', 1) for row in results),
          'input_tokens': inputs, 'mean_input_tokens_per_qa': inputs / len(results),
          'input_usd_per_million': price, 'estimated_batch_usd': inputs / 1e6 * price,
          'estimated_10000_qa_usd': inputs / len(results) * 10000 / 1e6 * price}
for field in ('providerDurationMs', 'durationMs'):
    values = sorted(row[field] for row in results)
    report[field] = {'median': statistics.median(values), 'mean': statistics.mean(values),
                     'p95': values[int((len(values) - 1) * .95)]}
print(json.dumps(report, ensure_ascii=False, indent=2))
