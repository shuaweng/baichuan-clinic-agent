#!/usr/bin/env python3
"""Validate the clinician task set; --execute explicitly requests real DSH answers."""
import argparse
import concurrent.futures
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LARGE = os.environ.get('PHYSICIAN_DATASET') == 'physician-100'
TOTAL = 100 if LARGE else 50
DATA = ROOT / ('data/physician-tasks-100' if LARGE else 'data/physician-tasks-50')
BATCH = 'physician-tasks-100-v1' if LARGE else 'physician-tasks-50-kb-v1'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate():
    manifest = json.loads((DATA / 'manifest.json').read_text())
    rows = [json.loads(line) for line in (DATA / 'scenarios.jsonl').read_text().splitlines()]
    catalog = json.loads((ROOT / 'config/agent-presets/catalog.json').read_text())
    presets = {entry['id']: entry for entry in catalog['presets']}
    require = lambda condition, message: None if condition else fail(message)
    require(digest(DATA / 'scenarios.jsonl') == manifest['scenarios_sha256'], 'Question set changed: revise its version and manifest before running.')
    require(len(rows) == manifest['session_count'] == TOTAL, 'Expected 50 sessions.')
    require([r['scenario_id'] for r in rows] == [f'D{i:03d}' for i in range(1, TOTAL + 1)], 'Missing, repeated or unordered scenario IDs.')
    require(dict(Counter(r['agent_preset'] for r in rows)) == manifest['preset_counts'], 'Preset counts differ from manifest.')
    queries = []
    for row in rows:
        require(row['agent_preset'] in presets, 'Unknown preset.')
        require(presets[row['agent_preset']]['name'] == row['sampling_group'], 'Wrong mode routing.')
        require(row['provenance']['real_physician_log'] is False, 'Synthetic task mislabeled as a real log.')
        require(row['source'] == 'research_informed_synthetic_physician_task', 'Unknown provenance.')
        require(1 <= len(row['turns']) <= 12 and [t['index'] for t in row['turns']] == list(range(1,len(row['turns'])+1)), 'Expected ordered two-turn tasks.')
        require(row['evaluation']['reference_status'] == 'task_constraints_only', 'Unverified criteria must not be a medical gold standard.')
        require(bool(row['evaluation']['unacceptable_errors']), 'Missing failure criteria.')
        for turn in row['turns']:
            require(isinstance(turn['user'], str) and bool(turn['user'].strip()), 'Empty question.')
            require(bool(turn['expected_checks']), 'Missing turn criteria.')
            require('answer' not in turn, 'Question fixtures must not include fabricated answers.')
            queries.append(turn['user'])
    require(len(queries) == manifest['turn_count'] and len(set(queries)) == len(queries), 'Expected 100 distinct questions.')
    for name, expected in manifest['preset_snapshot_sha256'].items():
        require(digest(ROOT / 'config/agent-presets' / name) == expected, f'Preset drift: {name}; create a new version before collecting answers.')
    if 'knowledge_corpus_sha256' in manifest:
        require(digest(ROOT / 'data/medical-kb/corpus.json') == manifest['knowledge_corpus_sha256'], 'Knowledge snapshot changed; version the batch before running.')
    return rows, manifest


def fail(message):
    raise SystemExit(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true', help='Call the configured DeepSeek model through local DSH.')
    parser.add_argument('--limit', type=int, default=TOTAL)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--ids', help='Comma-separated scenario IDs for a representative subset, e.g. D001,D025,D043.')
    args = parser.parse_args()
    if not 1 <= args.limit <= TOTAL or not 1 <= args.workers <= 3:
        parser.error('limit must be 1..50; workers must be 1..3')
    rows, manifest = validate()
    if args.ids:
        ids = args.ids.split(',')
        if len(set(ids)) != len(ids) or set(ids) - {row['scenario_id'] for row in rows}:
            parser.error('--ids must contain distinct existing scenario IDs')
        selected = [row for row in rows if row['scenario_id'] in ids]
    else:
        selected = rows[:args.limit]
    if not args.execute:
        print(json.dumps({'status': 'validated_no_model_calls', 'sessions': len(rows), 'turns': manifest['turn_count'],
                          'selected_sessions': len(selected), 'presets': manifest['preset_counts'],
                          'selected_ids': [row['scenario_id'] for row in selected],
                          'sent_fields': ['turns[].user'], 'rubrics_sent_to_answer_model': False}, ensure_ascii=False, indent=2))
        return

    # Validate the installed personas too: editing sources alone must not produce
    # an answer batch attributed to a configuration DSH has never loaded.
    common = (ROOT / 'config/agent-presets/clinical-common.md').read_text()
    catalog = json.loads((ROOT / 'config/agent-presets/catalog.json').read_text())
    for entry in catalog['presets']:
        expected = (ROOT / 'config/agent-presets' / entry['prompt']).read_text()
        if entry['clinical']:
            expected += '\n\n' + common
        expected += '\n\n' + (ROOT / 'config/agent-presets/knowledge.md').read_text()
        installed = ROOT / '.local/dsh-home/.agent-presets' / entry['id'] / 'agent.cordis.yml'
        if not installed.exists():
            fail('Start DSH with scripts/dsh-local.py before running this batch.')
        persona = next(r for r in json.loads(installed.read_text()) if r['id'] == 'persona')
        if persona['config']['prefix'] != expected:
            fail(f"Installed persona differs: {entry['id']}. Reload DSH before collecting answers.")

    module = load_module('physician_dsh_transport', ROOT / 'scripts/run-dsh-session-batch.py')
    module.BATCH = BATCH
    module.OUT = ROOT / '.local' / BATCH
    module.WORKSPACE = ROOT / '.local/dsh-physician-tasks-workspace'
    run_manifest = module.OUT / 'batch.json'
    prior = json.loads(run_manifest.read_text()) if run_manifest.exists() else None
    if prior and (prior['scenario_sha256'] != manifest['scenarios_sha256'] or prior['preset_snapshot_sha256'] != manifest['preset_snapshot_sha256'] or prior.get('knowledge_corpus_sha256') != manifest.get('knowledge_corpus_sha256')):
        fail('This run already contains a different question/persona snapshot; use a new version.')
    # On resume, keep the original model instead of silently adopting a new UI default.
    model = prior['model'] if prior else {**module.Client().rpc('session/modelCatalog', {})['default'], 'reasoningEffort': 'high'}
    module.WORKSPACE.mkdir(parents=True, exist_ok=True)
    requested_ids = sorted(set((prior or {}).get('requested_ids', [])) | {row['scenario_id'] for row in selected})
    module.save(run_manifest, {'batch_id': BATCH, 'model': model, 'requested_count': len(requested_ids),
                              'requested_ids': requested_ids,
                              'scenario_sha256': manifest['scenarios_sha256'],
                              'preset_snapshot_sha256': manifest['preset_snapshot_sha256'],
                              'knowledge_corpus_sha256': manifest.get('knowledge_corpus_sha256'),
                              'source': manifest['source_type']})
    # The transport receives only the routing metadata and user utterances.
    # Evaluation criteria stay in the question fixture, never in the model prompt.
    inputs = [{**{k: row[k] for k in ['scenario_id', 'title', 'sampling_group', 'agent_preset']},
               'batch_label': '医生任务', 'turns': [{'index': t['index'], 'user': t['user']} for t in row['turns']]}
              for row in selected]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda row: module.run(row, model), inputs))
    completed = []
    for row in rows:
        path = module.OUT / (row['scenario_id'] + '.json')
        if not path.exists():
            continue
        result = json.loads(path.read_text())
        if result['status'] == 'completed':
            result['source'] = 'research_informed_synthetic_physician_tasks_with_live_dsh_answers'
            result['task_type'] = row['task_type']
            completed.append(result)
    target = DATA / 'sessions.jsonl'
    pending = target.with_suffix('.jsonl.tmp')
    pending.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in completed))
    pending.replace(target)
    # Export real turn-scoped tool evidence for the evaluator; never manufacture answers.
    client = module.Client()
    evaluation_inputs = []
    scenarios = {row['scenario_id']: row for row in rows}
    for result in completed:
        row = client.row(result['session_id'])
        events = client.events(row)
        evidence_events = [event for event in events if event['type'] in
                           {'user/message', 'assistant/message', 'tool/result', 'turn/start', 'turn/end', 'request/context'}]
        module.save(module.OUT / 'events' / (result['scenario_id'] + '.json'), evidence_events)
        scenario = scenarios[result['scenario_id']]
        for index, turn in enumerate(result['turns']):
            tools = [event for event in evidence_events if event['type'] == 'tool/result'
                     and event['data'].get('turn') == turn['turn_id']]
            evaluation_inputs.append({
                'id': result['scenario_id'] + '-turn-' + str(index + 1),
                'batch_id': BATCH, 'session_id': result['session_id'],
                'source': result['source'], 'agent_preset': result['agent_preset'],
                'current': {'query': {'text': turn['query']}, 'answer': {'text': turn['answer']}},
                'history': [{'query': previous['query'], 'answer': previous['answer']} for previous in result['turns'][:index]],
                'task_contract': {'task_type': scenario['task_type'], 'user_role': 'physician_or_clinic_team',
                                  'expected_checks': scenario['turns'][index]['expected_checks'],
                                  'unacceptable_errors': scenario['evaluation']['unacceptable_errors'],
                                  'clinical_expert_reviewed': False},
                'execution': {'tool_results': tools, 'turn_log_complete': True},
                'provenance': {'query_event_seq': turn['query_event_seq'], 'answer_event_seqs': turn['answer_event_seqs'],
                               'end_event_seq': turn['end_event_seq'], 'model_routes': result['model_routes'],
                               'knowledge_corpus_sha256': manifest.get('knowledge_corpus_sha256')},
                'evaluation_status': 'not_evaluated',
            })
    module.save(DATA / 'evaluation-inputs.json', evaluation_inputs)
    module.save(DATA / 'collection-status.json', {
        'batch_id': BATCH, 'requested_ids': requested_ids,
        'completed_ids': [result['scenario_id'] for result in completed],
        'completed_sessions': len(completed), 'answered_turns': len(evaluation_inputs),
        'total_planned_sessions': len(rows), 'evaluation_status': 'not_evaluated',
    })
    print(f'Completed {len(completed)}/{TOTAL} sessions; real answers: {target}')
    if any(row['status'] != 'completed' for row in results):
        fail('Some sessions are incomplete; saved their actual state without generating replacement answers.')


if __name__ == '__main__':
    main()
