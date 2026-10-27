"""Integration invariants checked against downloaded, unmodified source records."""
import csv
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.packages'),str(ROOT/'scripts')]
sys.path.insert(0,str(ROOT/'scripts'))
from runtime import configure
configure()
import torch
from preprocess_datasets import OUT, META, read_csv, parse_obo, RAW
from models.hgnn_ebm import EnergyModel

def test_sources_and_provenance():
    annotations=read_csv('source_annotations.csv')
    assert {a['source'] for a in annotations}=={'HPO','Orphadata'}
    hpo=[a for a in annotations if a['source']=='HPO']
    assert all('evidence' in json.loads(a['metadata']) for a in hpo)
    assert any(a['state']=='absent' for a in hpo)
    assert any(a['frequency'] for a in annotations)
    assert all(a['state']!='absent' or ('NOT' in json.loads(a['metadata']).get('qualifier','') or 'excluded' in a['frequency'].lower()) for a in annotations)

def test_ontology_relationships_preserved():
    terms,_=parse_obo(RAW/'hpo/hp.obo')
    rows=read_csv('phenotypes.csv')
    assert len(rows)>0
    assert all(json.loads(r['synonyms'])==terms[r['phenotype_id']].get('synonym',[]) for r in rows)
    assert all(json.loads(r['parents'])==terms[r['phenotype_id']].get('is_a',[]) for r in rows)

def test_model_gradient_uses_real_training_graph():
    from runtime import require_cuda
    device=require_cuda()
    torch.set_num_threads(2)
    torch.manual_seed(8)
    graph=torch.load(OUT/'hypergraph_data.pt',weights_only=True)
    model=EnergyModel(graph['num_nodes'],hidden=8).to(device)
    x=model.hgnn(graph['train_incidence_index'].to(device),graph['num_hyperedges'])
    pairs=[(n,e) for n,e in graph['train_incidence_index'].T.tolist() if n>=len(graph['disease_ids'])][:16]
    nodes,edges=zip(*pairs)
    energy=model.score(x[list(nodes)],x[list(edges)])
    assert torch.isfinite(energy).all()
    energy.sum().backward()
    assert model.hgnn.layers[0].weight.grad.abs().sum()>0
    assert model.energy[0].weight.grad.abs().sum()>0

def test_no_heldout_hyperedge_in_training():
    graph=torch.load(OUT/'hypergraph_data.pt',weights_only=True)
    used=set(graph['train_incidence_index'][1].tolist())
    assert all(graph['disease_split'][graph['disease_ids'][i]]=='train' for i in used)
    heldout=[d for d,s in graph['disease_split'].items() if s!='train']
    assert heldout

def test_mapping_has_auditable_ambiguity():
    report=json.loads((META/'processing_report.json').read_text())
    mapping=report['mapping']
    assert mapping['hpo_diseases']==mapping['matched_to_orphadata']+len(mapping['unmatched_hpo_identifiers'])
    assert 0<=mapping['coverage']<=1
    assert mapping['unmatched_hpo_identifiers']

def test_unknown_observations_do_not_become_absent():
    from backend.knowledge_base import KnowledgeBase
    kb=KnowledgeBase()
    hp=next(iter(kb.phenotypes))
    states=kb.observations([dict(phenotype_id=hp,state='unknown')])
    assert states['unknown']=={hp} and not states['absent'] and not states['present']
    assert kb.overlap([dict(phenotype_id=hp,state='unknown')])==[]
    import pytest
    with pytest.raises(ValueError,match='Conflicting input'):
        kb.observations([dict(phenotype_id=hp,state='present'),dict(phenotype_id=hp,state='absent')])


def test_cpu_execution_rejected():
    import pytest
    model=EnergyModel(4,hidden=8)
    with pytest.raises(RuntimeError,match='CUDA GPU is required'):
        model.hgnn(torch.tensor([[0,1],[0,0]]),1)


def test_cuda_unavailable_fails_closed(monkeypatch):
    import pytest
    from runtime import require_cuda
    monkeypatch.setattr(torch.cuda,'is_available',lambda:False)
    with pytest.raises(RuntimeError,match='CUDA GPU is required'):
        require_cuda()


def test_final_checkpoint_cuda_inference():
    from runtime import require_cuda
    device=require_cuda()
    checkpoint=torch.load(ROOT/'runs/final-gpu-training/best_model.pt',map_location=device,weights_only=True)
    manifest=json.loads((META/'dataset_manifest.json').read_text())
    assert checkpoint['data_sha256']==manifest['processed_sha256']
    model=EnergyModel(checkpoint['num_nodes'],checkpoint['hidden']).to(device)
    model.load_state_dict(checkpoint['state_dict'])
    model.eval()
    assert all(p.is_cuda and torch.isfinite(p).all() for p in model.parameters())
    graph=torch.load(OUT/'hypergraph_data.pt',weights_only=True)
    incidence=graph['train_incidence_index'].to(device)
    n_disease=len(graph['disease_ids'])
    phenotype=incidence[0][incidence[0]>=n_disease][0]
    with torch.no_grad():
        embedding=model.hgnn(incidence,graph['num_hyperedges'])
        scores=model.score(embedding[phenotype].expand(n_disease,-1),embedding[:n_disease])
        assert scores.is_cuda and scores.shape==(n_disease,) and torch.isfinite(scores).all()
        assert scores.std()>0
        ranking=scores.topk(5,largest=False).indices
        assert len(set(ranking.tolist()))==5
