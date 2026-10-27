"""Verify checkpoint provenance, reload, and forward pass on real graph records."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'.packages'),str(ROOT)]
sys.path.insert(0,str(ROOT/'scripts'))
from runtime import configure
configure()
from runtime import require_cuda
import torch
from models.hgnn_ebm import EnergyModel

device=require_cuda()
torch.set_num_threads(4)
checkpoint=torch.load(ROOT/'runs/final-gpu-training/best_model.pt',weights_only=True,map_location=device)
manifest=json.loads((ROOT/'data/metadata/dataset_manifest.json').read_text())
assert checkpoint['data_sha256']==manifest['processed_sha256'], 'Stale model data fingerprint'
graph=torch.load(ROOT/'data/processed/hypergraph_data.pt',weights_only=True)
model=EnergyModel(checkpoint['num_nodes'],checkpoint['hidden']).to(device)
model.load_state_dict(checkpoint['state_dict'])
model.eval()
assert all(torch.isfinite(p).all() for p in model.parameters())
with torch.no_grad():
    embedding=model.hgnn(graph['train_incidence_index'].to(device),graph['num_hyperedges'])
    real_memberships=[(n,e) for n,e in graph['train_incidence_index'].T.tolist() if n>=len(graph['disease_ids'])]
    n,e=real_memberships[0]
    energy=model.score(embedding[n:n+1],embedding[e:e+1])
    assert torch.isfinite(energy).all()
report=dict(status='passed',checkpoint='runs/final-gpu-training/best_model.pt',device=str(device),trained_epochs=checkpoint['epochs'],
            parameters=sum(p.numel() for p in model.parameters()),data_fingerprint_matches=True,
            actual_phenotype_id=graph['phenotype_ids'][n-len(graph['disease_ids'])],actual_disease_id=graph['disease_ids'][e],
            finite_energy=float(energy.item()),note='Reload/forward verification only; energy is not probability or clinical validation.')
(ROOT/'models/model_verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
