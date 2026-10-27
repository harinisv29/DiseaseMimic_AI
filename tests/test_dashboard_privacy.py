"""Local browser boundary tests; these are software checks, not compliance validation."""
import time
from fastapi import FastAPI
from fastapi.testclient import TestClient
from dashboard_access import LocalBrowserBoundary,SESSIONS,issue_session

def client():
    app=FastAPI()
    app.add_middleware(LocalBrowserBoundary)
    @app.post('/rank')
    def rank():return {'reached':True}
    return TestClient(app)

def test_browser_origin_requires_a_live_memory_token():
    c=client();origin={'Origin':'http://127.0.0.1:5173'}
    assert c.post('/rank',headers=origin).status_code==401
    token=issue_session()['token']
    headers={**origin,'X-Assessment-Session':token}
    response=c.post('/rank',headers=headers)
    assert response.status_code==200
    assert response.headers['cache-control']=='no-store'
    assert response.headers['referrer-policy']=='no-referrer'
    SESSIONS[token]=time.monotonic()-1
    assert c.post('/rank',headers=headers).status_code==401

def test_untrusted_browser_is_rejected_and_local_research_scripts_are_preserved():
    c=client()
    assert c.post('/rank',headers={'Origin':'https://untrusted.example'}).status_code==403
    assert c.post('/rank').json()=={'reached':True}

def test_session_contains_no_patient_information_and_tokens_are_unique():
    one,two=issue_session(),issue_session()
    assert one['token']!=two['token']
    assert set(one)=={'token','expiresInSeconds'}
    assert 60<=one['expiresInSeconds']<=7200

def test_missing_dataset_fails_without_reference_or_model_fallback(monkeypatch):
    import pytest
    import architecture_data
    from pathlib import Path
    from uuid import uuid4
    from backend.knowledge_base import KnowledgeBase
    # A nonexistent isolated path requires no mutation of real datasets or Windows temp ACLs.
    missing=Path(__file__).resolve().parents[1]/'runs'/'patient-centered-upgrade'/('missing-dataset-'+uuid4().hex)
    assert not missing.exists()
    with pytest.raises(RuntimeError,match='dataset download, preprocessing and validation'):
        KnowledgeBase(missing)
    monkeypatch.setattr(architecture_data,'ROOT',missing)
    with pytest.raises(FileNotFoundError,match='hypergraph_data'):
        architecture_data.Corpus()
