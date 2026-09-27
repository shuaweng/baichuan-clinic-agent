import importlib.util
from pathlib import Path
p=Path(__file__).with_name('run-dsh-session-batch.py')
s=importlib.util.spec_from_file_location('transport',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
c=m.Client.__new__(m.Client)
calls=[]
def rpc(method,args):
 req=args['request'];calls.append(req.copy())
 if 'beforeSeq' not in req:return {'records':[{'event':{'seq':i}} for i in [3,4]],'hasMore':True}
 return {'records':[{'event':{'seq':i}} for i in [0,1,2]],'hasMore':False}
c.rpc=rpc
assert [r['seq'] for r in c.events({'sessionId':'isolated-test','projections':{'asOfSeq':4}})]==[0,1,2,3,4]
assert calls[1]['beforeSeq']==3
print('DSH multi-page history: passed (mock RPC, no external calls)')
