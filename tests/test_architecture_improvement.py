"""Behavioral and real-data CUDA tests for inductive disease-profile ranking."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from runtime import require_cuda
import pytest
import torch
from architecture_data import Corpus,OUT,sparse,tied_statistics,sample_negatives
from models.profile_hgnn import ProfileHGNN
from observation_recommendation import recommend,recommendation_values

@pytest.fixture(scope='module')
def corpus():
    torch.set_num_threads(4)
    return Corpus()


def test_id_maps_and_permitted_reference(corpus):
    c=corpus
    for d in (0,len(c.diseases)//2,len(c.diseases)-1):assert c.di[c.diseases[d]]==d
    for p in (0,len(c.phenotypes)//2,len(c.phenotypes)-1):assert c.pi[c.phenotypes[p]]==p
    rows=corpus.rows
    r=next(r for r in rows if r['state']=='present' and corpus.pi[r['phenotype_id']] not in c.absent[c.di[r['disease_id']]])
    assert c.pi[r['phenotype_id']] in c.profiles[c.di[r['disease_id']]]
    for s in ('validation','test'):
        assert not (set(c.split[s])&set(c.train_all))
    assert set(c.incidence[1].tolist()).issubset(set(c.train_all))
    strict_rows=set(c.strict_reference.indices()[0].tolist())
    assert strict_rows.issubset(set(c.train_all))
    assert not (set(c.split['test'])&strict_rows)


def test_tie_metrics_direction_and_candidate_order():
    device=require_cuda()
    score=torch.tensor([[1.,2.,3.],[2.,2.,2.]],device=device)
    stats=tied_statistics(score,torch.tensor([2,1],device=device))
    assert stats['top_1'][0]==1 and stats['mrr'][0]==1
    assert stats['top_1'][1].item()==pytest.approx(1/3)
    assert stats['mrr'][1].item()==pytest.approx((1+1/2+1/3)/3)
    permutation=torch.tensor([2,0,1],device=device)
    other=tied_statistics(score[:,permutation],torch.tensor([0,2],device=device))
    assert torch.allclose(stats['mrr'],other['mrr'])
    energy=-score
    assert energy[0].argmin()==2


def test_inductive_heldout_profile_and_cuda_backward(corpus):
    c=corpus;torch.manual_seed(8)
    model=ProfileHGNN(c.np,16).to(c.device)
    raw,graph=model.encode(c.incidence,c.nd)
    disease=model.pool(c.pool,graph);strict=model.pool(c.strict_pool,graph)
    held=c.split['test'][:2]
    assert disease[held].abs().sum()>0
    assert strict[held].abs().sum()==0
    assert not any('disease' in name for name,_ in model.named_parameters())
    obs,_=c.queries(c.split['train'][:4]);query=model.pool(c.weighted_observations(obs),graph)
    qraw=model.pool(c.weighted_observations(obs),raw);draw=model.pool(c.pool,raw)
    loss=model.graph_energy(query,disease[c.split['train'][:4]]).sum()+model.raw_energy(qraw,draw[c.split['train'][:4]]).sum()
    loss.backward()
    assert torch.isfinite(loss)
    assert all(p.is_cuda and p.grad is not None and p.grad.is_cuda and torch.isfinite(p.grad).all() for p in model.parameters())
    assert model.layers[0].weight.grad.abs().sum()>0


def test_hard_negatives_filter_labels_and_compatible_supersets():
    device=require_cuda()
    overlap=torch.tensor([[1.,1.,.8,.5,.1]],device=device)
    labels=torch.tensor([0],device=device);allowed=torch.arange(5,device=device)
    negative,mask=sample_negatives(overlap,labels,allowed,n_hard=1,n_random=12)
    assert negative[0,0]==2
    assert torch.all(negative[mask]!=0) and torch.all(negative[mask]!=1)
    assert overlap.gather(1,negative)[mask].max()<1


def test_masking_missing_unknown_and_baseline(corpus):
    c=corpus;ids=c.split['test'][:8]
    full,fullrows=c.queries(ids,1.)
    half,halfrows=c.queries(ids,.5)
    half2,_=c.queries(ids,.5)
    assert torch.equal(half.to_dense(),half2.to_dense())
    assert all(a.issubset(b) for a,b in zip(halfrows,fullrows))
    noisy,noisyrows=c.queries(ids,.5,noise=True)
    assert all(len(n)>len(h) for n,h in zip(noisyrows,halfrows))
    overlap,weighted=c.matching(half)
    labels=torch.tensor(ids,device=c.device)
    assert torch.allclose(overlap.gather(1,labels[:,None]),torch.ones(len(ids),1,device=c.device))
    assert torch.allclose(weighted.gather(1,labels[:,None]),torch.ones(len(ids),1,device=c.device),atol=1e-5)
    p=next(iter(halfrows[0]));other=next(p for p in range(c.np) if p not in halfrows[0])
    a=c.observation_matrix([p],unknown=[other]);b=c.observation_matrix([p])
    assert torch.equal(a.to_dense(),b.to_dense())
    with pytest.raises(ValueError):c.observation_matrix([p],absent=[p])


def test_no_silent_cpu_fallback():
    model=ProfileHGNN(5,8)
    with pytest.raises(RuntimeError,match='CUDA GPU is required'):
        model.encode(torch.tensor([[0],[0]]),1)


def test_recommendation_unknown_absent_and_availability():
    from types import SimpleNamespace
    device=require_cuda()
    c=SimpleNamespace(profiles=[{0,1},{0,2}],absent=[{2},{1}],frequency=[{0:.9,1:.9},{0:.9,2:.9}],phenotypes=['HP:A','HP:B','HP:C'])
    candidates=[0,1];posterior=torch.tensor([.5,.5],device=device)
    answer=recommend(c,candidates,posterior,present=[0],unknown=[1],available={1})
    assert len(answer)==1 and answer[0]['phenotype_id']=='HP:B' and answer[0]['reassessment']
    assert answer[0]['expected_information_gain_nats']>0
    assert recommend(c,candidates,posterior,present=[0],absent=[1],available={1})==[]
    c.profiles[1].remove(2);c.frequency[1].pop(2)
    options,prob,_,_=recommendation_values(c,candidates,posterior,available={2})
    assert prob[1,0]==.5  # unrecorded is unknown, not absent


def test_improved_checkpoint_mapping_and_inference(corpus):
    path=OUT/'best_model.pt'
    if not path.exists():pytest.skip('Post-training checkpoint validation runs after fitting')
    c=corpus;checkpoint=torch.load(path,map_location=c.device,weights_only=True)
    assert checkpoint['phenotype_ids']==c.phenotypes and checkpoint['disease_ids']==c.diseases
    assert checkpoint['data_sha256']==c.manifest['processed_sha256']
    model=ProfileHGNN(c.np,checkpoint['hidden']).to(c.device);model.load_state_dict(checkpoint['state_dict']);model.eval()
    from improve_architecture import Experiment
    with torch.no_grad():
        experiment=Experiment(c,model);obs,_=c.queries(c.split['test'][:2])
        scores=experiment.scores(obs,experiment.representations())
    assert all(v.is_cuda and torch.isfinite(v).all() and v.shape==(2,c.nd) for v in scores.values())
    strict=experiment.scores(obs,experiment.representations(strict=True),strict=True)
    assert all(v[:,~c.known].std(1).max()==0 for v in strict.values())


def test_validation_selection_preserves_baseline_and_prior_checkpoints():
    import hashlib
    config_path=OUT/'inference_config.json'
    if not config_path.exists():pytest.skip('Validation selection completes after training')
    config=json.loads(config_path.read_text())
    validation=json.loads((OUT/'validation_metrics.json').read_text())
    baseline=config['best_baseline'];default=config['default_method']
    if default not in ('overlap','weighted'):
        assert validation[default]['mrr']>validation[baseline]['mrr']+.001
    grid=config['hybrid']['grid']
    assert config['hybrid']['validation_mrr']==max(row['mrr'] for row in grid)
    hashes=json.loads((OUT/'preserved_checkpoints.json').read_text())
    assert all(hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==sha for path,sha in hashes.items())


def test_improved_integration_api_respects_states_and_availability():
    if not (OUT/'inference_config.json').exists():pytest.skip('Post-training integration check')
    from backend.ranker import DiseaseRanker
    ranker=DiseaseRanker()
    d=ranker.c.split['test'][0];profile=sorted(ranker.c.profiles[d])
    present=[ranker.c.phenotypes[profile[0]]]
    available=[ranker.c.phenotypes[p] for p in profile[1:]]
    result=ranker.rank(present,unknown=available[:1],available=available,limit=5)
    assert result['device']=='cuda:0' and len(result['rankings'])==5
    assert all(r['phenotype_id'] in available for r in result['next_observations'])
    scores=[r['score'] for r in result['rankings']]
    assert scores==sorted(scores,reverse=True)
    with pytest.raises(ValueError,match='Conflicting'):
        ranker.rank(present,absent=present)
    with pytest.raises(ValueError,match='Unsupported'):
        ranker.rank(['HP:NONEXISTENT'])


def test_numerical_ties_do_not_create_false_ranking(corpus):
    c=corpus
    scores=torch.tensor([[1.,1.+1e-7,.5]],device=c.device)
    st=tied_statistics(scores,torch.tensor([0],device=c.device))
    assert st['top_1'].item()==pytest.approx(.5)
    assert st['mrr'].item()==pytest.approx(.75)
    ids=c.split['validation'][:32]
    obs,_=c.queries(ids)
    a,b=c.matching(obs)
    labels=torch.tensor(ids,device=c.device)
    sa,sb=tied_statistics(a,labels),tied_statistics(b,labels)
    assert torch.allclose(sa['mrr'],sb['mrr'],atol=1e-6)
    assert torch.allclose(sa['top_1'],sb['top_1'],atol=1e-6)
