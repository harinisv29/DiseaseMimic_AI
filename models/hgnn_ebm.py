"""Sparse profile-hyperedge message passing and a learned compatibility energy."""
import torch
from torch import nn

class HGNN(nn.Module):
    def __init__(self, n_nodes, hidden=48):
        super().__init__()
        self.embedding=nn.Embedding(n_nodes,hidden)
        self.layers=nn.ModuleList([nn.Linear(hidden,hidden),nn.Linear(hidden,hidden)])
        self.dropout=nn.Dropout(0.15)

    def forward(self, incidence, n_edges):
        if not self.embedding.weight.is_cuda or not incidence.is_cuda:
            raise RuntimeError('CUDA GPU is required for DiseaseMimic AI training.')
        node,edge=incidence
        x=self.embedding.weight
        node_degree=torch.bincount(node,minlength=len(x)).clamp_min(1).to(x.dtype).rsqrt()
        edge_degree=torch.bincount(edge,minlength=n_edges).clamp_min(1).to(x.dtype)
        h=torch.sparse_coo_tensor(incidence,torch.ones(len(node),device=x.device),size=(len(x),n_edges),check_invariants=True).coalesce()
        for layer in self.layers:
            aggregate=torch.sparse.mm(h.transpose(0,1),x*node_degree[:,None])/edge_degree[:,None]
            message=torch.sparse.mm(h,aggregate)*node_degree[:,None]
            x=self.dropout(torch.relu(layer(message+x)))
        return x

class EnergyModel(nn.Module):
    def __init__(self,n_nodes,hidden=48):
        super().__init__()
        self.hgnn=HGNN(n_nodes,hidden)
        self.energy=nn.Sequential(nn.Linear(hidden*3,hidden),nn.GELU(),nn.Linear(hidden,1))

    def score(self,profile,disease):
        if not profile.is_cuda or not disease.is_cuda or not next(self.energy.parameters()).is_cuda:
            raise RuntimeError('CUDA GPU is required for DiseaseMimic AI training.')
        return self.energy(torch.cat([profile,disease,profile*disease],dim=-1)).squeeze(-1)
