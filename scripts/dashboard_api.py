"""Read-only dashboard adapters; original API/model files remain unchanged."""
import json
from functools import lru_cache
from fastapi import APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from runtime import ROOT
from backend.app import app
from dashboard_access import LocalBrowserBoundary, issue_session
from preprocess_datasets import read_csv

router=APIRouter(prefix='/dashboard',tags=['Dashboard reference data'])

class Phenotype(BaseModel):
    id:str
    label:str

class SearchPhenotype(Phenotype):
    synonyms:list[str]

class ReferencePhenotype(Phenotype):
    state:str
    frequencies:list[str]
    sources:list[str]

class DiseaseEvidence(BaseModel):
    id:str
    label:str
    sources:list[str]
    phenotypes:list[ReferencePhenotype]

@lru_cache(maxsize=1)
def vocabulary():
    return read_csv('phenotypes.csv')

@lru_cache(maxsize=1)
def names():
    return {r['phenotype_id']:r['name'] for r in vocabulary()}, {r['disease_id']:r for r in read_csv('diseases.csv')}

@router.get('/phenotypes',response_model=list[SearchPhenotype])
def search_phenotypes(q:str=Query(min_length=2,max_length=150),limit:int=Query(default=15,ge=1,le=50)):
    term=q.casefold().strip()
    found=[r for r in vocabulary() if term in r['phenotype_id'].casefold() or term in r['name'].casefold() or term in r['synonym_labels'].casefold()]
    found.sort(key=lambda r:(not (r['name'].casefold()==term or any(alias.casefold()==term for alias in json.loads(r['synonym_labels']))),not r['name'].casefold().startswith(term),r['name']))
    return [SearchPhenotype(id=r['phenotype_id'],label=r['name'],synonyms=json.loads(r['synonym_labels'])) for r in found[:limit]]

@router.get('/evidence',response_model=list[DiseaseEvidence])
def evidence(ids:str=Query(max_length=1500)):
    disease_ids=list(dict.fromkeys(ids.split(',')))
    if len(disease_ids)>20:raise HTTPException(422,'At most 20 candidate diseases are supported')
    phenotypes,diseases=names()
    if any(d not in diseases for d in disease_ids):raise HTTPException(422,'Unknown disease identifier')
    grouped={d:{} for d in disease_ids}
    for r in app.state.ranker.c.rows:
        if r['disease_id'] in grouped:
            grouped[r['disease_id']].setdefault(r['phenotype_id'],[]).append(r)
    result=[]
    for d in disease_ids:
        profile=[]
        for hp,rows in sorted(grouped[d].items()):
            states={r['state'] for r in rows}
            state='conflicting' if {'present','absent'}.issubset(states) else 'present' if 'present' in states else 'absent' if 'absent' in states else 'unknown'
            profile.append(ReferencePhenotype(id=hp,label=phenotypes[hp],state=state,
                frequencies=sorted({f for r in rows for f in json.loads(r['frequencies']) if f}),
                sources=sorted({s for r in rows for s in json.loads(r['sources'])})))
        result.append(DiseaseEvidence(id=d,label=diseases[d]['name'],sources=json.loads(diseases[d]['sources']),phenotypes=profile))
    return result

@router.get('/metadata')
def metadata():
    processing=json.loads((ROOT/'data/metadata/validation_report.json').read_text())
    manifest=json.loads((ROOT/'data/metadata/dataset_manifest.json').read_text())
    run=ROOT/'runs/architecture-improvement'
    return dict(diseases=processing.get('diseases'),associations=processing.get('associations'),phenotypes=processing.get('phenotypes'),
        evaluation=json.loads((run/'test_metrics.json').read_text()),training=json.loads((run/'training_summary.json').read_text()),
        selection=json.loads((run/'inference_config.json').read_text()),
        sources=[{k:r.get(k) for k in ('name','source_url','license','downloaded_at','source_version')} for r in manifest['datasets']])

class SearchRequest(BaseModel):
    q:str=Field(min_length=2,max_length=150)
class TermsRequest(BaseModel):
    ids:list[str]=Field(max_length=50)

@router.post('/session')
def browser_session():
    return issue_session()

@router.post('/phenotypes/search',response_model=list[SearchPhenotype])
def private_search(body:SearchRequest):
    return search_phenotypes(body.q,15)

@router.post('/terms')
def terms(body:TermsRequest):
    wanted=set(body.ids)
    if any(not value.startswith('HP:') or len(value)!=10 for value in wanted):
        raise HTTPException(422,'Invalid HPO identifier')
    result=[]
    for row in vocabulary():
        if row['phenotype_id'] in wanted:
            definitions=json.loads(row['definition'])
            # Return the ontology's own wording; no generated medical explanation.
            result.append(dict(id=row['phenotype_id'],label=row['name'],synonyms=json.loads(row['synonym_labels']),
                definitions=definitions,source='Human Phenotype Ontology',source_url='https://hpo.jax.org/browse/term/'+row['phenotype_id']))
    return result

app.add_middleware(LocalBrowserBoundary)
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['GET','POST'],allow_headers=['Content-Type','X-Assessment-Session'])
app.include_router(router)
