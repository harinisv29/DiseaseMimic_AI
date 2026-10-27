"""Inductive phenotype-profile HGNN with independent compatibility ablations."""
import torch
from torch import nn
from torch.nn import functional as F


def cuda_only(*tensors):
    if any(not x.is_cuda for x in tensors):
        raise RuntimeError('CUDA GPU is required for DiseaseMimic AI training.')


class Compatibility(nn.Module):
    """Lower energy is better; residual nonlinear compatibility around cosine."""
    def __init__(self, hidden):
        super().__init__()
        self.mlp=nn.Sequential(nn.Linear(hidden*4,hidden),nn.GELU(),nn.Dropout(.05),nn.Linear(hidden,1))

    def forward(self,q,d):
        cuda_only(q,d,next(self.parameters()))
        return -(q*d).sum(-1)+.1*self.mlp(torch.cat((q,d,q*d,(q-d).abs()),-1)).squeeze(-1)


class ProfileHGNN(nn.Module):
    """No disease-ID parameters. Hyperedges are training disease profiles."""
    def __init__(self,n_phenotypes,hidden=64):
        super().__init__()
        self.embedding=nn.Embedding(n_phenotypes,hidden)
        self.layers=nn.ModuleList([nn.Linear(hidden,hidden),nn.Linear(hidden,hidden)])
        self.norms=nn.ModuleList([nn.LayerNorm(hidden),nn.LayerNorm(hidden)])
        self.dropout=nn.Dropout(.05)
        self.raw_energy=Compatibility(hidden)
        self.graph_energy=Compatibility(hidden)

    def encode(self,incidence,n_edges,use_graph=True):
        cuda_only(incidence,self.embedding.weight)
        x=F.normalize(self.embedding.weight,dim=-1)
        raw=x
        if use_graph:
            node,edge=incidence
            h=torch.sparse_coo_tensor(incidence,torch.ones_like(node,dtype=x.dtype),
                (len(x),n_edges),check_invariants=True).coalesce()
            nd=torch.bincount(node,minlength=len(x)).clamp_min(1).float().rsqrt()
            ed=torch.bincount(edge,minlength=n_edges).clamp_min(1).float()
            for layer,norm in zip(self.layers,self.norms):
                edges=torch.sparse.mm(h.T,x*nd[:,None])/ed[:,None]
                message=torch.sparse.mm(h,edges)*nd[:,None]
                x=norm(x+self.dropout(F.gelu(layer(message))))
        return raw,F.normalize(x,dim=-1)

    @staticmethod
    def pool(profile_matrix,embedding):
        cuda_only(profile_matrix,embedding)
        return F.normalize(torch.sparse.mm(profile_matrix,embedding),dim=-1)
