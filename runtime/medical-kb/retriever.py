"""Local Haystack BM25 worker. NDJSON over pipes; no HTTP or model calls."""
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ['HAYSTACK_TELEMETRY_ENABLED'] = 'False'
os.environ['HAYSTACK_CONTENT_TRACING_ENABLED'] = 'False'
from haystack import Document
from haystack.components.retrievers.in_memory import InMemoryBM25Retriever
from haystack.document_stores.in_memory import InMemoryDocumentStore

root = Path(__file__).resolve().parents[2]
raw = (root / 'data/medical-kb/corpus.json').read_bytes()
manifest = json.loads((root / 'data/medical-kb/manifest.json').read_text())
if hashlib.sha256(raw).hexdigest() != manifest['corpus_sha256']:
    raise RuntimeError('Knowledge corpus checksum mismatch')
corpus = json.loads(raw)
store = InMemoryDocumentStore(bm25_algorithm='BM25Okapi')
store.write_documents([Document(id=c['id'], content=c['text'] + '\n' + c['title'],
    meta={'gynecology': 'gynecology' in c['scope'], 'pediatrics': 'pediatrics' in c['scope'],
          'source_id': c['source_id']}) for c in corpus['chunks']])
retriever = InMemoryBM25Retriever(document_store=store, top_k=6)

for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        query = request['query']
        scope = request.get('specialty', 'all')
        limit = request.get('limit', 4)
        if not isinstance(query, str) or not query.strip() or len(query) > 4000:
            raise ValueError('Invalid query')
        if scope not in ['all', 'gynecology', 'pediatrics'] or not isinstance(limit, int) or not 1 <= limit <= 6:
            raise ValueError('Invalid search parameters')
        conditions = []
        if scope != 'all':
            conditions.append({'field': 'meta.' + scope, 'operator': '==', 'value': True})
        # Disaster-setting rules must not silently enter ordinary clinic answers.
        if not request.get('humanitarian_context', False):
            conditions.append({'field': 'meta.source_id', 'operator': '!=', 'value': 'who-ccc'})
        filters = {'operator': 'AND', 'conditions': conditions} if conditions else None
        docs = retriever.run(query=query, filters=filters, top_k=limit)['documents']
        result = {'id': request['id'], 'results': [{'id': d.id, 'score': d.score}
                  for d in docs if d.score is not None and d.score > 0]}
    except Exception as error:
        result = {'id': request.get('id'), 'error': str(error)}
    print(json.dumps(result, ensure_ascii=False), flush=True)
