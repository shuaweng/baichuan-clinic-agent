# Local medical RAG

DSH tool adapter → local Haystack 2.22 BM25 worker → versioned WHO/CDC excerpts.

Setup from repository root (Python 3.12 recommended):

```sh
python3 -m venv .local/medical-rag-venv
.local/medical-rag-venv/bin/python -m pip install -r runtime/medical-kb/requirements.lock.txt
.local/medical-rag-venv/bin/python scripts/build-medical-kb.py
npm --prefix runtime/medical-kb test
```

Reload the owned local DSH process using `scripts/dsh-local.py` after confirming no conversation is running. Existing sessions may retain their original preset context; use a new conversation to test the updated tools.

The NDJSON worker has no listening port and disables Haystack telemetry/content tracing. It retains the index while active and exits after 30 seconds idle. Searches are keyword based with limited Chinese/English query expansion, not multilingual embedding search. No medical correctness guarantee follows from a match.

Source license, version, population and original locator travel with each tool result. WHO PNC/CCC materials are CC BY-NC-SA 3.0 IGO; use here is local non-commercial research. CDC selected excerpts preserve original English, attribution and source links. Review rights before commercial distribution. Chinese generated explanations are not official translations; institutions do not endorse this product.

See `research/medical-rag-and-citations-2026-09-23.md` for source selection, alternatives, and the proposed clinician citation UI.
