"""Build a local, auditable report from completed Jev results; makes no API calls."""
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/session-batch-50'
RESULTS = ROOT / '.local/maternal-fresh-50-20260922/jev-results-v1'
FIELDS = ['service_scope', 'capability_coverage', 'explicit_dissatisfaction',
          'response_coverage', 'context_consistency', 'execution_claim']
TITLES = dict(zip(FIELDS, ['服务范围', '能力覆盖', '明确不满', '回答覆盖', '上下文一致', '执行声称']))
LABELS = {'in_scope': '范围内', 'outside_scope': '范围外', 'restricted': '越过边界',
          'mixed': '混合诉求', 'no_task': '无新任务', 'unknown': '信息不足',
          'configured': '已配置', 'not_integrated': '未接入', 'partial': '部分覆盖',
          'not_applicable': '不适用', 'addressed': '已回应',
          'appropriate_clarification': '合理澄清', 'appropriate_limit': '合理解释限制',
          'off_target': '答非所问', 'insufficient_evidence': '证据不足',
          'consistent': '一致', 'contradicted': '存在冲突', 'no_claim': '无执行声称',
          'supported': '有证据支持', 'unverifiable': '无法核验'}
SPOTCHECKS = {
    'S004-turn-2': '用户说“我刚才说错了”，是在纠正自己上一轮提供的年龄，并要求按新年龄回答。Jev 给出不满概率0.51，处于摇摆区；该轮没有明确抱怨产品，不宜按0.5阈值直接计入已确认不满。',
    'S025-turn-2': '用户明确要求“请先写摘要，再告诉我……是否真的保存”，回答却以“先说明第二件事”开头，先解释保存能力，后给摘要。内容均有回应，但输出顺序违反本轮要求。另外，用户是在核实保存状态，并未明确要求执行保存；该轮被归入能力缺口可能混淆了“咨询能力”和“请求执行”，需要复核。',
    'S046-turn-1': '用户说孩子“下周”复查、希望“前一天晚上”提醒，回答先建议“设个明晚的闹钟/日历提醒”，后又写“设到前一天晚上”。具体复查日期尚未给出，“明晚”缺少依据，且两处时间表述不一致。',
    'S046-turn-2': '本轮已将诉求降为“可复制到手机日历的文字，并明确有没有创建成功”，主要需要文本整理和能力状态说明。Jev 仍选择未接入（0.36），与已配置（0.35）几乎持平，疑似沿用了上一轮的自动提醒意图。另外“不满概率0.58”只应视为摇摆线索，该句没有明确抱怨。',
}


def read(path):
    return json.loads(path.read_text())


def write(name, value):
    (DATA / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    manifest = read(RESULTS / 'manifest.json')
    expected = {item['id']: item['hash'] for item in manifest['requests']}
    sessions = [json.loads(line) for line in (DATA / 'sessions.jsonl').read_text().splitlines()]
    rows, results = [], []
    counts = {field: Counter() for field in FIELDS}
    for session in sessions:
        for turn in session['turns']:
            row = {key: session[key] for key in ['scenario_id', 'title', 'sampling_group', 'session_id']}
            row.update({key: turn[key] for key in ['turn_id', 'query', 'answer']})
            row['id'] = f"{session['scenario_id']}-turn-{turn['turn_id']}"
            row['previous_turns'] = [{key: t[key] for key in ['turn_id', 'query', 'answer']}
                                     for t in session['turns'] if t['turn_id'] < turn['turn_id']]
            row['labels'], row['provenance'] = {}, {}
            for mode in ['query', 'qa']:
                task = row['id'] + '-' + mode
                result = read(RESULTS / f'{task}.result.json')
                request = read(RESULTS / f'{task}.request.json')
                # Requests were hashed with JS JSON.stringify. Preserve order, UTF-8, no spaces.
                digest = hashlib.sha256(json.dumps(request, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
                if result['status'] != 'evaluated':
                    raise ValueError(f'{task}: incomplete; refusing a complete-batch report')
                if not (digest == expected[task] == result['request_sha256'] == result['input_sha256']):
                    raise ValueError(f'{task}: request fingerprint mismatch')
                if result['question_version'] != manifest['question_version']:
                    raise ValueError(f'{task}: question version mismatch')
                if set(result['answers']) != set(request['questions']):
                    raise ValueError(f'{task}: missing/extra questions')
                for name, answer in result['answers'].items():
                    if answer['type'] == 'choice':
                        probs = answer['probabilities']
                        if set(probs) != set(request['questions'][name]['criteria']):
                            raise ValueError(f'{task}/{name}: invalid choices')
                        if answer['choice'] not in probs or not all(0 <= p <= 1 for p in probs.values()):
                            raise ValueError(f'{task}/{name}: invalid probabilities')
                        if abs(sum(probs.values()) - 1) > .04:
                            raise ValueError(f'{task}/{name}: invalid probability sum')
                    elif answer['type'] != 'boolean' or not 0 <= answer['probability'] <= 1:
                        raise ValueError(f'{task}/{name}: invalid boolean answer')
                row['labels'].update(result['answers'])
                row['provenance'][mode] = {key: result.get(key) for key in
                                           ['input_sha256', 'question_version', 'model_reported', 'evaluated_at']}
                results.append(result)
            if set(row['labels']) != set(FIELDS):
                raise ValueError(f"{row['id']}: expected six labels")
            row['uncertain_fields'] = []
            for field, answer in row['labels'].items():
                if answer['type'] == 'choice':
                    scores = sorted(answer['probabilities'].values(), reverse=True)
                    counts[field][answer['choice']] += 1
                    if scores[0] < .60 or round(scores[0] - scores[1], 6) < .20:
                        row['uncertain_fields'].append(field)
                else:
                    probability = answer['probability']
                    counts[field]['p>=0.5' if probability >= .5 else 'p<0.5'] += 1
                    if .35 <= probability <= .65:
                        row['uncertain_fields'].append(field)
            labels = {key: val.get('choice') for key, val in row['labels'].items()}
            row['badcase_signals'] = [field for field, bad in {
                'response_coverage': ['partial', 'off_target'],
                'context_consistency': ['contradicted'],
                'execution_claim': ['contradicted'],
            }.items() if labels[field] in bad]
            row['queues'] = []
            if row['badcase_signals']:
                row['queues'].append('badcase_candidate')
            if labels['service_scope'] in ['in_scope', 'mixed'] and labels['capability_coverage'] in ['not_integrated', 'partial']:
                row['queues'].append('capability_gap_candidate')
            if any(v in ['unknown', 'insufficient_evidence', 'unverifiable'] for v in labels.values()):
                row['queues'].append('missing_evidence')
            if row['uncertain_fields']:
                row['queues'].append('uncertain')
            if row['labels']['explicit_dissatisfaction']['probability'] >= .5:
                row['queues'].append('dissatisfaction')
            row['spotcheck_note'] = SPOTCHECKS.get(row['id'])
            if row['spotcheck_note']:
                row['queues'].append('spotcheck_note')
            rows.append(row)
    assert len(rows) == 100 and len(results) == len(expected) == 200
    assert len({r['id'] for r in rows}) == 100
    queues = {name: [r['id'] for r in rows if name in r['queues']] for name in
              ['badcase_candidate', 'capability_gap_candidate', 'uncertain', 'missing_evidence', 'dissatisfaction', 'spotcheck_note']}
    usage = {key: sum(r.get('usage', {}).get(key, 0) or 0 for r in results)
             for key in ['inputTokens', 'outputTokens', 'totalTokens']}
    costs = {}
    for key in ['cost', 'marketCost', 'gatewayCost']:
        values = [r.get('gateway', {}).get(key) for r in results]
        costs[key] = {'requests_reporting': sum(v is not None for v in values),
                      'sum_as_reported': str(sum((Decimal(str(v)) for v in values if v is not None), Decimal(0)))}
    summary = {
        'generated_at': datetime.now(timezone.utc).isoformat(), 'sessions': len(sessions),
        'evaluated_turns': len(rows), 'successful_requests': len(results), 'judgments': 600,
        'question_version': manifest['question_version'], 'model': 'typesafe-ai/jev',
        'label_counts': counts, 'review_queues': queues,
        'review_queue_counts': {k: len(v) for k, v in queues.items()},
        'uncertain_fields': Counter(f for r in rows for f in r['uncertain_fields']),
        'spotcheck_method': 'Codex 对产品流程与用户约束做定向原文抽查，非医学审核、非人工金标准、非全部样本复审；笔记不是 Jev 输出。',
        'uncertainty_rule': 'Choice: max probability < 0.60 OR top-two margin < 0.20; Boolean: 0.35 <= p <= 0.65. Diagnostic heuristic, not calibrated confidence.',
        'usage_successful_requests': usage, 'gateway_cost_fields_successful_requests': costs,
        'limits': ['合成问题与真实 DSH 回答；不代表真实用户需求占比。',
                   '未评医学正确性；无人工金标准，不能计算准确率、召回率。',
                   '候选队列来自确定性规则，可重叠；概率不是经校准的置信度。',
                   '能力缺口不等于新需求，当前未接入需求池去重或价值验证。',
                   '429 是评估调用限流，不计入产品 badcase；用量仅汇总200次成功请求。']}
    write('jev-summary.json', summary)
    write('jev-evaluation-contract.json', {
        'question_version': manifest['question_version'],
        'product_contract': read(RESULTS / 'S001-turn-1-query.request.json')['state']['product_contract'],
        'questions': {mode: read(RESULTS / f'S001-turn-1-{mode}.request.json')['questions'] for mode in ['query', 'qa']},
        'uncertainty_rule': summary['uncertainty_rule'],
        'review_queues_are_candidates': True,
    })
    (DATA / 'jev-labels.jsonl').write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
    with (DATA / 'jev-labels.csv').open('w', newline='', encoding='utf-8-sig') as stream:
        fields = ['id', 'session_id', 'sampling_group', 'title', 'query', *FIELDS, 'review_queues', 'uncertain_fields']
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            flat = {key: row[key] for key in fields if key in row}
            flat.update({key: value.get('choice', value.get('probability')) for key, value in row['labels'].items()})
            flat['review_queues'] = ';'.join(row['queues'])
            flat['uncertain_fields'] = ';'.join(row['uncertain_fields'])
            writer.writerow(flat)
    lines = ['# Jev 首批打标结果', '',
             f"50 个 Session / 100 轮 / 200 次成功请求 / 600 个判断，规则版本 `{manifest['question_version']}`。", '',
             '## 标签分布', '', '| 维度 | 分布（轮） |', '| --- | --- |']
    for field in FIELDS:
        lines.append('| ' + TITLES[field] + ' | ' + '；'.join(f'{LABELS.get(k,k)} {v}' for k,v in counts[field].most_common()) + ' |')
    lines += ['', '## 待复核队列', '', '队列可重叠，不应相加当作问题总量。这里只列候选；不自动认定医学错误或已验证的新需求。', '']
    for name, ids in queues.items():
        lines.append(f'- `{name}`：{len(ids)} 轮。' + ('、'.join(ids) if ids else '无'))
    lines += ['', '## 定向抽查发现', '', summary['spotcheck_method'], '']
    for row in rows:
        if row['spotcheck_note']:
            lines.append(f"- **{row['id']}**：{row['spotcheck_note']} Jev 的上下文标签为 `{row['labels']['context_consistency']['choice']}`，冲突概率 {row['labels']['context_consistency']['probabilities']['contradicted']:.0%}。")
    lines += ['', '## 下一版评估建议（本次未改题重跑）', '',
              '- 能力覆盖先区分“请求执行”“询问是否已执行”“询问能否执行”；提到未接入功能不自动等于功能缺口。',
              '- 将时间锚点、人物归属、输出顺序等显式约束拆成可独立核对的题目，避免宽泛的一致性题掩盖细节。',
              '- 区分用户降级诉求、补充约束与明确不满；跨轮意图已改变时，以本轮请求为准。',
              '- 为上述边界构造正反对照并人工标注，按 Session 留出验证集，再测漏判与误报；不据这一批无金标准结果宣称准确率。']
    lines += ['', '## 复核规则', '',
              '- badcase 候选：回答部分覆盖/答非所问、上下文冲突或执行声称冲突。',
              '- 能力缺口候选：范围内/混合诉求，且能力未接入/部分覆盖。',
              '- 判断摇摆：选择题最高概率 < 0.60 或前两项差值 < 0.20；布尔题概率 0.35–0.65。该阈值只是复核启发式，未经校准。',
              '- 输入/证据不足与调用限流单独处理，不等于产品回答失败。', '', '## 边界与追溯', '']
    lines += ['- ' + text for text in summary['limits']]
    lines += ['', '完整原文、每项概率、历史与筛选见 [交互报告](jev-report.html)。结构化结果见 [JSONL](jev-labels.jsonl)、[CSV](jev-labels.csv) 和 [汇总](jev-summary.json)。',
              '', f"成功请求用量：{usage['inputTokens']:,} input / {usage['outputTokens']:,} output / {usage['totalTokens']:,} total tokens。", '',
              '费用保留网关原始字段，不将 marketCost 与实际账单混同：`' + json.dumps(costs, ensure_ascii=False) + '`。', '',
              '原始 request/result 在 `.local/maternal-fresh-50-20260922/jev-results-v1/`，每次请求都有 SHA-256；报表导出时核验全部200份输入指纹。']
    (DATA / 'jev-report.md').write_text('\n'.join(lines) + '\n')
    render_html(rows, summary)
    batch_summary = read(DATA / 'summary.json')
    batch_summary['jev_evaluation'] = {'status': 'completed', 'question_version': manifest['question_version'],
                                       'evaluated_turns': 100, 'successful_requests': 200, 'report': 'jev-report.html'}
    write('summary.json', batch_summary)
    print(json.dumps({'counts': counts, 'queues': {k:len(v) for k,v in queues.items()}, 'usage': usage, 'costs': costs}, ensure_ascii=False, indent=2))


def render_html(rows, summary):
    template = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>百川妇幼专科Agent · Jev评估</title>
<style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#20302c;background:#f3f6f2;line-height:1.65}body{margin:0}main{max-width:1160px;margin:auto;padding:36px 24px}h1{font-size:30px;letter-spacing:-1px;margin:6px 0}h2{font-size:21px}small,.muted{color:#5e6e67}.eyebrow{font-size:12px;letter-spacing:2px;color:#54755d}.intro{max-width:840px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.stat,article,.bar{background:white;border:1px solid #d9e2d7;border-radius:12px;padding:18px}.stat strong{display:block;font-size:30px;font-weight:600}.bar{display:flex;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:2;box-shadow:0 3px 12px #1231}select,input,button{font:inherit;border:1px solid #bacbbb;background:white;border-radius:7px;padding:8px 12px}input{flex:1;min-width:180px}button{cursor:pointer}button:hover{background:#edf5e9}article{margin:16px 0}article h2{margin:2px 0 4px}.tag{display:inline-block;border-radius:20px;background:#edf3ea;color:#3d5d38;padding:3px 9px;margin:2px 6px 2px 0;font-size:12px}.flag{background:#fff0d8;color:#865a14}.labels{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:15px 0}.label{border:1px solid #e4e9e1;padding:10px;border-radius:8px}.label b{display:block;font-size:15px}.label small{display:block;font-size:12px}.qa{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}.query{padding:12px;background:#f0f5ef;border-radius:8px}summary{cursor:pointer;font-weight:600;margin:9px 0}.note{border-left:3px solid #ae8d46;padding-left:14px;font-size:13px}#count{margin-top:16px}footer{padding:30px 0;font-size:12px}.empty{padding:32px;text-align:center}@media(max-width:720px){.stats,.labels{grid-template-columns:repeat(2,1fr)}main{padding:22px 14px}h1{font-size:24px}.bar{position:static}}
</style><main>
<div class="eyebrow">百川妇幼专科AGENT / 评估工作台</div><h1>从对话到可复核的产品信号</h1>
<p class="intro muted">50 个合成场景，100 轮真实 DSH 回答。Jev 分别读取诉求与 QA，输出 600 个结构化判断。点击样本查看原始回答、上一轮上下文与概率分布。</p>
<div class="stats" id="stats"></div>
<p class="note">标签用于发现线索，不能作为医学正确性认证。能力缺口需与需求池去重、验证价值；badcase 候选需复核。判断摇摆指最高概率 &lt; 0.60 或前两项差值 &lt; 0.20；布尔题概率 0.35–0.65，均未经校准。另有 Codex 定向抽查疑点，可通过下方队列筛选查看；抽查笔记与 Jev 原始输出分开保存。</p>
<div class="bar"><select id="queue" aria-label="复核队列"></select><select id="group" aria-label="人群主题"></select><input id="search" placeholder="搜索编号、问题或回答" aria-label="搜索"><button id="reset">重置</button></div>
<div id="count" class="muted" aria-live="polite"></div><div id="results"></div>
<footer>本页纯本地，无网络请求。规则版本 maternal-gateway-0.1。200 次输入 SHA-256 均已核验；原始问答与评估结果未改写。队列可重叠，合成样本分布不代表真实用户需求占比。</footer></main>
<script id="payload" type="application/json">__DATA__</script><script>
const {rows,summary:stats,titles,labels}=JSON.parse(document.getElementById('payload').textContent);
const queueNames={all:'全部样本',badcase_candidate:'badcase 候选',capability_gap_candidate:'能力缺口候选',uncertain:'判断摇摆',missing_evidence:'证据不足',dissatisfaction:'明确不满候选',spotcheck_note:'Codex 抽查疑点'};
const byId=id=>document.getElementById(id), make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
for(const [title,count] of [['已评估问答',100],['badcase 候选',stats.review_queue_counts.badcase_candidate],['能力缺口候选',stats.review_queue_counts.capability_gap_candidate],['判断摇摆',stats.review_queue_counts.uncertain]]){const e=make('div',undefined,'stat');e.append(make('strong',count),make('span',title));byId('stats').append(e)}
for(const [value,text] of Object.entries(queueNames)){const o=make('option',text+(value==='all'?' · 100':' · '+stats.review_queue_counts[value]));o.value=value;byId('queue').append(o)}
for(const text of ['全部主题',...new Set(rows.map(r=>r.sampling_group))]){const o=make('option',text);o.value=text;byId('group').append(o)}
function render(){const q=byId('queue').value,g=byId('group').value,s=byId('search').value.trim().toLowerCase();const list=rows.filter(r=>(q==='all'||r.queues.includes(q))&&(g==='全部主题'||r.sampling_group===g)&&(!s||[r.id,r.title,r.query,r.answer].join(' ').toLowerCase().includes(s)));byId('count').textContent=`显示 ${list.length} / 100 轮 · 候选队列可重叠`;const target=byId('results');target.replaceChildren();
for(const r of list){const card=make('article');card.append(make('small',r.id+' · '+r.sampling_group),make('h2',r.title));for(const q of r.queues)card.append(make('span',queueNames[q],'tag flag'));card.append(make('div',r.query,'qa query'));if(r.spotcheck_note)card.append(make('p','Codex 定向抽查（非 Jev 输出、非医学审核）：'+r.spotcheck_note,'note'));const ll=make('div',undefined,'labels');
for(const [field,a] of Object.entries(r.labels)){const cell=make('div',undefined,'label');cell.append(make('small',titles[field]+(r.uncertain_fields.includes(field)?' · 摇摆':'')));if(a.type==='choice'){cell.append(make('b',(labels[a.choice]||a.choice)+' · '+Math.round(a.probabilities[a.choice]*100)+'%'));const details=make('details');details.append(make('summary','概率分布'));for(const [k,p] of Object.entries(a.probabilities).sort((a,b)=>b[1]-a[1]))details.append(make('small',(labels[k]||k)+' '+Math.round(p*100)+'%'));cell.append(details)}else cell.append(make('b','不满概率 '+Math.round(a.probability*100)+'%'));ll.append(cell)}card.append(ll);
const answer=make('details');answer.append(make('summary','查看本轮真实回答'),make('div',r.answer,'qa'));card.append(answer);if(r.previous_turns.length){const history=make('details');history.append(make('summary','查看上一轮上下文'));for(const t of r.previous_turns)history.append(make('div','用户：'+t.query+'\\n\\n助手：'+t.answer,'qa'));card.append(history)}const provenance=make('details');provenance.append(make('summary','来源与输入指纹'),make('div','Session: '+r.session_id+'\\n'+JSON.stringify(r.provenance,null,2),'qa muted'));card.append(provenance);target.append(card)}if(!list.length)target.append(make('p','没有匹配的样本','empty'))}
for(const id of ['queue','group','search'])byId(id).addEventListener('input',render);byId('reset').addEventListener('click',()=>{byId('queue').value='all';byId('group').value='全部主题';byId('search').value='';render()});render();
</script></html>'''
    payload = json.dumps({'rows': rows, 'summary': summary, 'titles': TITLES, 'labels': LABELS}, ensure_ascii=False).replace('<', '\\u003c')
    (DATA / 'jev-report.html').write_text(template.replace('__DATA__', payload))


if __name__ == '__main__':
    main()
