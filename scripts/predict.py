"""Rank all diseases on CUDA from actual present HPO observations."""
import argparse
import json
from runtime import ROOT, require_cuda
import torch
from models.hgnn_ebm import EnergyModel

ap=argparse.ArgumentParser()
ap.add_argument('phenotypes',nargs='+',help='Present HPO identifiers')
ap.add_argument('--top-k',type=int,default=10)
args=ap.parse_args()
device=require_cuda()
graph=torch.load(ROOT/'data/processed/hypergraph_data.pt',weights_only=True,map_location='cpu')
checkpoint=torch.load(ROOT/'runs/final-gpu-training/best_model.pt',weights_only=True,map_location=device)
manifest=json.loads((ROOT/'data/metadata/dataset_manifest.json').read_text())
if checkpoint['data_sha256']!=manifest['processed_sha256']:
    raise RuntimeError('Checkpoint data fingerprint mismatch')
lookup={hp:i+len(graph['disease_ids']) for i,hp in enumerate(graph['phenotype_ids'])}
unknown=set(args.phenotypes)-lookup.keys()
if unknown: ap.error('Unknown HPO IDs: '+', '.join(sorted(unknown)))
if not 1<=args.top_k<=len(graph['disease_ids']): ap.error('Invalid top-k')
model=EnergyModel(checkpoint['num_nodes'],checkpoint['hidden']).to(device)
model.load_state_dict(checkpoint['state_dict']); model.eval()
with torch.no_grad():
    embedding=model.hgnn(graph['train_incidence_index'].to(device),graph['num_hyperedges'])
    q=embedding[torch.tensor([lookup[hp] for hp in sorted(set(args.phenotypes))],device=device)].mean(0)
    diseases=embedding[:len(graph['disease_ids'])]
    with torch.autocast('cuda',dtype=torch.bfloat16,enabled=torch.cuda.is_bf16_supported()):
        scores=model.score(q.expand_as(diseases),diseases).float()
    values,indices=scores.topk(args.top_k,largest=False)
result=dict(device=str(device),observed_phenotypes=sorted(set(args.phenotypes)),
    rankings=[dict(disease_id=graph['disease_ids'][i],energy=v) for i,v in zip(indices.tolist(),values.tolist())],
    note='Research compatibility energy, not probability. Cold-start evaluation underperformed phenotype overlap.')
print(json.dumps(result,indent=2))
