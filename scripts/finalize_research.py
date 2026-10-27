"""Additional prespecified diagnostic verification and attribution analysis."""
import hashlib
import json
from runtime import ROOT
import torch
from architecture_data import Corpus,OUT,write_json
from improve_architecture import Experiment,paired_difference
from models.profile_hgnn import ProfileHGNN
from backend.ranker import DiseaseRanker

torch.set_num_threads(4)
c=Corpus()
checkpoint=torch.load(OUT/'best_model.pt',map_location=c.device,weights_only=True)
assert checkpoint['phenotype_ids']==c.phenotypes and checkpoint['disease_ids']==c.diseases
assert checkpoint['data_sha256']==c.manifest['processed_sha256']
model=ProfileHGNN(c.np,checkpoint['hidden']).to(c.device);model.load_state_dict(checkpoint['state_dict'])
exp=Experiment(c,model)
decision=json.loads((OUT/'inference_config.json').read_text())
metrics,stats=exp.evaluate(c.split['test'],hybrid=decision['hybrid'],return_stats=True)
comparison=paired_difference(stats['hgnn_ebm'],stats['ebm'],c,c.split['test'])
write_json(OUT/'hypergraph_attribution.json',dict(hgnn_ebm_minus_raw_ebm_mrr=comparison,
    interpretation='A CI spanning zero does not establish incremental benefit of hypergraph propagation. Hybrid improvement over matching does not by itself attribute that improvement to HGNN.'))
idx=c.graph['train_incidence_index'];heldout=c.split['validation']+c.split['test']
degree=torch.bincount(idx[0],minlength=c.graph['num_nodes'])
original=[]
for relative in json.loads((OUT/'preserved_checkpoints.json').read_text()):
    ck=torch.load(ROOT/relative,map_location='cpu',weights_only=True)
    assert ck['num_nodes']==c.graph['num_nodes'] and ck['data_sha256']==c.manifest['processed_sha256']
    original.append(dict(path=relative,epochs=ck['epochs'],hidden=ck['hidden'],state_tensors=len(ck['state_dict'])))
write_json(OUT/'diagnostic_verification.json',dict(original_checkpoints=original,
    heldout_diseases_checked=len(heldout),heldout_disease_nodes_with_training_degree=int((degree[heldout]>0).sum()),
    source_diseases=c.nd,source_phenotypes=c.np,all_candidate_reference_rows=c.reference.shape[0],train_hyperedges=len(set(c.incidence[1].tolist())),
    model_disease_id_parameters=0,checkpoint_mapping_matches=True,selected_checkpoint_cuda_parameters=all(p.is_cuda for p in model.parameters())))
ranker=DiseaseRanker();target=c.split['test'][0];profile=sorted(c.profiles[target]);present=[c.phenotypes[p] for p in profile[:max(1,len(profile)//2)]]
available=[c.phenotypes[p] for p in profile[len(profile)//2:]]
example=ranker.rank(present,unknown=available[:1],available=available,limit=10)
write_json(OUT/'inference_example.json',dict(target_disease=c.diseases[target],**example))
seeds=json.loads((OUT/'seed_comparison.json').read_text())
summary={}
for name in ('hgnn','ebm','hgnn_ebm'):
    values=torch.tensor([s['test_50_percent'][name]['mrr'] for s in seeds],device=c.device)
    summary[name]=dict(seeds=len(seeds),mrr_mean=values.mean().item(),mrr_sample_std=values.std().item(),mrr_values=values.tolist())
write_json(OUT/'seed_robustness_summary.json',summary)
report=OUT/'final_research_report.md'
with report.open('a',encoding='utf-8') as f:
    f.write('\n\n## Hypergraph attribution and seed robustness\n\n')
    f.write('HGNN+EBM minus raw EBM paired test MRR: '+json.dumps(comparison)+'.\n\n')
    f.write('Independent training-seed results: '+json.dumps(summary)+'.\n\n')
    f.write('The old test and new test use different fixed phenotype masks and tie calculations; their raw MRR numbers are not a controlled before/after comparison. The six-method comparison within Setting A is controlled.\n\n')
    f.write('Inference ranks present observations only. Known absent states suppress completed observation recommendations; unknown states remain eligible for reassessment. No penalty for unrecorded phenotypes is introduced.\n')
print(json.dumps(dict(hypergraph_attribution=comparison,seed_robustness=summary,inference_method=example['method'])),flush=True)
