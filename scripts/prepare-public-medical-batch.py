#!/usr/bin/env python3
"""Select 50 reproducible, unedited source questions and paired reference answers."""
import csv,json,re,hashlib,random,shutil,difflib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT/'.local/chinese-medical-source';DEST=ROOT/'data/chinese-medical-50';DEST.mkdir(exist_ok=True)
manifest=json.loads((SOURCE/'manifest.json').read_text());commit=manifest['commit']
groups={
'gynecology': [('月经与妇科症状',r'月经|痛经|闭经'),('妇科炎症与检查',r'阴道炎|宫颈|白带|盆腔'),('孕期健康',r'孕期|孕妇|产检|胎动|孕酮|胎儿'),('产后与哺乳',r'产后|哺乳|奶水|剖腹产'),('生殖与围绝经',r'不孕|备孕|避孕|绝经|更年期')],
'pediatrics':[('新生儿与婴儿',r'新生儿|黄疸|婴儿|早产'),('儿童呼吸与发热',r'咳嗽|发烧|发热|肺炎'),('儿童消化与喂养',r'腹泻|拉肚子|便秘|喂养|呕吐'),('儿童皮肤与过敏',r'湿疹|皮疹|过敏|荨麻疹'),('儿童发育与保健',r'发育|身高|多动|语言|疫苗|肥胖')]}
excluded={(x['source_path'],x['csv_record_index']) for x in json.loads((DEST/'selection-exclusions.json').read_text())} if (DEST/'selection-exclusions.json').exists() else set()
selected=[];seen=set();rng=random.Random(20260923)
for specialty,definitions in groups.items():
 file=SOURCE/(specialty+'.csv');rawsha=hashlib.sha256(file.read_bytes()).hexdigest()
 sourcepath=next(x['path'] for x in manifest['tree']['tree'] if x['path'].endswith('.csv') and ('OAGD' if specialty=='gynecology' else 'Pediatric') in x['path'])
 with file.open(encoding='gb18030',newline='') as f:
  reader=csv.DictReader(f);pool=[];last=reader.line_num
  for index,row in enumerate(reader,1):
   line_start=last+1;last=reader.line_num
   q=row.get('ask','').strip();a=row.get('answer','').strip();title=row.get('title','').strip()
   if not 40<=len(q)<=650 or not 60<=len(a)<=1200:continue
   if any(re.search(p,q+' '+a) for p in [r'1[3-9]\d{9}',r'\d{17}[0-9Xx]',r'https?://',r'[\w.+-]+@[\w.-]+\.[A-Za-z]+']):continue
   if specialty=='gynecology' and re.search(r'男\s*\d|我是男|男，|男,|精子|阳痿|包皮',q):continue
   if specialty=='pediatrics' and (not re.search(r'宝宝|宝贝|婴|孩子|小孩|女儿|儿子|小儿|儿童|新生儿',q) or re.search(r'(?:1[9]|[2-9]\d)岁',q)):continue
   pool.append((index,line_start,last,row))
 rng.shuffle(pool)
 for group,pattern in definitions:
  count=0
  for index,line_start,line_end,row in pool:
   q=row['ask'].strip();a=row['answer'].strip();title=row['title'].strip()
   if (sourcepath,index) in excluded:continue
   if not re.search(pattern,q) or not re.search(pattern,title):continue
   if group=='孕期健康' and re.search(r'不孕|输卵管|性别|男孩|女孩子|下体|来事那几天',q):continue
   if '我也不知道为什么会有这个病' in q:continue
   if group=='产后与哺乳' and (re.search(r'流产|小产|打胎',q) or not re.search(r'产后|哺乳|奶水',q)):continue
   if re.search(r'上班状态|老板说|智力低下医院|先天性脑瘫.*预防|四个月.*说话|才4个月.*说话',q):continue
   if '黄体囊肿干扰绝经' in q or '一开始长势喜人' in q:continue
   key=re.sub(r'\W','',q)
   if key in seen or any(difflib.SequenceMatcher(None,key,re.sub(r'\W','',s['turns'][0]['user'])).ratio()>.78 for s in selected):continue
   ident=f'CMD{len(selected)+1:03d}'
   selected.append({'scenario_id':ident,'title':title,'sampling_group':group,'agent_preset':'baichuan-gynecology' if specialty=='gynecology' else 'baichuan-pediatrics','turns':[{'index':1,'user':q}],
   'reference_material':{'answer':a,'question':q,'trust':'unreviewed_public_dataset_reference_not_gold_standard','source_url':f'https://github.com/Toyhom/Chinese-medical-dialogue-data/blob/{commit}/{sourcepath}#L{line_start}-L{line_end}','source_commit':commit,'source_path':sourcepath,'csv_record_index':index,'csv_line_start':line_start,'csv_line_end':line_end,'source_sha256':rawsha,'record_sha256':hashlib.sha256(json.dumps(row,ensure_ascii=False,sort_keys=True).encode()).hexdigest(),'department':row['department']}})
   seen.add(key);count+=1
   if count==5:break
  assert count==5,(group,count)
payload=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in selected)
if (ROOT/'.local/chinese-medical-50-20260923/batch.json').exists() and (DEST/'scenarios.jsonl').read_text()!=payload:
 raise SystemExit('Source batch is frozen after generation; use a new dataset for changed selection')
(DEST/'scenarios.jsonl').write_text(payload)
shutil.copyfile(SOURCE/'LICENSE',DEST/'SOURCE-LICENSE.txt')
(DEST/'source-manifest.json').write_text(json.dumps({'repository':manifest['repository'],'commit':commit,'seed':20260923,'sampling':'25妇产科+25儿科；10个主题各5条；关键词分层随机抽样，非真实流量分布','question_transformation':'仅去除首尾空白，保留原文；不拼接或生成追问','patient_authenticity':'从公开仓库提取，仓库未提供逐条原站及原始就诊记录，未独立验证真实患者来源','reference_status':'配对原答案，未作医学审核，不是金标准','count':len(selected)},ensure_ascii=False,indent=2))
for r in selected:print(r['scenario_id'],r['sampling_group'],r['turns'][0]['user'])
