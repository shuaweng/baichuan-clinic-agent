#!/usr/bin/env python3
"""Verify collected physician answers against DSH events and prepare a readable export. No API calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import os

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ('data/physician-tasks-100' if os.environ.get('PHYSICIAN_DATASET') == 'physician-100' else 'data/physician-tasks-50')
status = json.loads((DATA / 'collection-status.json').read_text())
records = [json.loads(line) for line in (DATA / 'sessions.jsonl').read_text().splitlines()]
scenarios = {r['scenario_id']: r for r in map(json.loads, (DATA / 'scenarios.jsonl').read_text().splitlines())}
inputs = json.loads((DATA / 'evaluation-inputs.json').read_text())
spec = importlib.util.spec_from_file_location('transport', ROOT / 'scripts/run-dsh-session-batch.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
assert len({r['scenario_id'] for r in records}) == len(records)
report = ['# 医生任务：真实 DSH 回答', '',
          f"已完成 {len(records)} 个 session、{sum(len(r['turns']) for r in records)} 轮。题目为合成医生场景，回答由实际 DSH 模型生成；评估状态见本批 JEV/DeepSeek 结果文件。", '']
for record in records:
    scenario = scenarios[record['scenario_id']]
    assert record['status'] == 'completed' and len(record['turns']) == len(scenario['turns']) and record['model_routes']
    events_path = ROOT / '.local' / status['batch_id'] / 'events' / (record['scenario_id'] + '.json')
    events = json.loads(events_path.read_text())
    report += [f"## {record['scenario_id']} · {record['sampling_group']} · {record['title']}", '',
               f"DSH session：`{record['session_id']}`", '']
    for index, turn in enumerate(record['turns'], 1):
        assert turn['query'] == scenario['turns'][index - 1]['user']
        user = next(e for e in events if e['seq'] == turn['query_event_seq'])
        restored = transport.extract(events, user['data']['source']['rpcId'])
        assert restored['answer'] == turn['answer'] and restored['completion']['kind'] == 'completed'
        item = next(x for x in inputs if x['id'] == record['scenario_id'] + '-turn-' + str(index))
        assert item['current']['answer']['text'] == turn['answer']
        assert len(item['execution']['tool_results']) == turn['tool_result_count']
        text = turn['answer']
        item['current']['answer']['segments'] = [
            {'id': f"{item['id']}-p{i + 1}", 'start': m.start(), 'end': m.end(), 'text': m.group()}
            for i, m in enumerate(re.finditer(r'\S[\s\S]*?(?=\n\s*\n|\Z)', text))]
        item['provenance']['evidence_events_sha256'] = hashlib.sha256(events_path.read_bytes()).hexdigest()
        item['evidence'] = {'origin': 'actual_dsh_tool_results', 'independent_clinical_review': False,
                            'read_chunks': [e['data']['meta'] for e in item['execution']['tool_results']
                                            if e['data'].get('meta', {}).get('source_presence') == 'local_snapshot_verified']}
        report += [f'### 第 {index} 轮 · 问题', '', turn['query'], '', '### 实际回答', '', turn['answer'], '']
(DATA / 'answers.md').write_text('\n'.join(report))
(DATA / 'evaluation-inputs.json').write_text(json.dumps(inputs, ensure_ascii=False, indent=2) + '\n')
manifest_path = DATA / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest.update(status='answers_collected' if len(records) == manifest['session_count'] else 'answers_partially_collected',
                completed_sessions=len(records), answered_turns=len(inputs), evaluation_status='not_evaluated',
                answer_configuration='Real DSH answers with local Haystack retrieval enabled; original queries unchanged')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
summary = {'verified_sessions': len(records), 'verified_turns': len(inputs),
           'tool_result_count': sum(len(x['execution']['tool_results']) for x in inputs),
           'turns_with_read_evidence': sum(bool(x['evidence']['read_chunks']) for x in inputs),
           'preset_counts': {p: sum(r['agent_preset'] == p for r in records) for p in sorted({r['agent_preset'] for r in records})},
           'models': sorted({r['model_requested']['model'] for r in records}),
           'evaluation_status': 'not_evaluated'}
(DATA / 'collection-verification.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, ensure_ascii=False, indent=2))
