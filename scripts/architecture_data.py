"""Source-backed profile matrices, deterministic masks, honest tie metrics."""
import hashlib
import json
import math
import random
from collections import defaultdict
from runtime import ROOT,require_cuda
import torch
from preprocess_datasets import read_csv

METHODS=['overlap','weighted','hgnn','ebm','hgnn_ebm','hybrid']
OUT=ROOT/'runs/architecture-improvement'

def write_json(path,data):
    path.write_text(json.dumps(data,indent=2,allow_nan=False),encoding='utf-8')


def sparse(rows,ncols,device,weights=None):
    ii=[];jj=[];vv=[]
    for i,row in enumerate(rows):
        for p in sorted(row):
            ii.append(i);jj.append(p);vv.append(1. if weights is None else weights[i][p])
    idx=torch.tensor([ii,jj],dtype=torch.long,device=device)
    return torch.sparse_coo_tensor(idx,torch.tensor(vv,device=device,dtype=torch.float32),(len(rows),ncols),check_invariants=True).coalesce()


class Corpus:
    def __init__(self):
        self.device=require_cuda()
        self.graph=torch.load(ROOT/'data/processed/hypergraph_data.pt',weights_only=True,map_location='cpu')
        self.diseases=self.graph['disease_ids']; self.phenotypes=self.graph['phenotype_ids']
        self.nd=len(self.diseases);self.np=len(self.phenotypes)
        self.di={d:i for i,d in enumerate(self.diseases)};self.pi={p:i for i,p in enumerate(self.phenotypes)}
        self.rows=read_csv('disease_phenotype.csv')
        self.profiles=[set() for _ in self.diseases];self.absent=[set() for _ in self.diseases]
        self.frequency=[{} for _ in self.diseases]
        for r in self.rows:
            if r['state']=='absent':self.absent[self.di[r['disease_id']]].add(self.pi[r['phenotype_id']])
        for r in self.rows:
            d=self.di[r['disease_id']];p=self.pi[r['phenotype_id']]
            if r['state']!='present' or p in self.absent[d]:continue
            self.profiles[d].add(p)
            numeric=[]
            for e in json.loads(r['evidence']):
                lo,hi=e.get('frequency_lower'),e.get('frequency_upper')
                if lo is not None and hi is not None:
                    numeric.append(max(.01,min(.99,(float(lo)+float(hi))/2)))
            self.frequency[d][p]=sum(numeric)/len(numeric) if numeric else .75
        ds=read_csv('diseases.csv');self.groups={self.di[r['disease_id']]:r['identity_group'] for r in ds}
        self.split={s:[i for i,p in enumerate(self.profiles) if len(p)>=2 and self.graph['disease_split'][self.diseases[i]]==s] for s in ('train','validation','test')}
        self.train_all=[i for i,d in enumerate(self.diseases) if self.graph['disease_split'][d]=='train']
        self.reference=sparse(self.profiles,self.np,self.device)
        trainset=set(self.train_all)
        trainrows=[self.profiles[i] if i in trainset else set() for i in range(self.nd)]
        self.strict_reference=sparse(trainrows,self.np,self.device)
        df=torch.sparse.sum(self.strict_reference,dim=0).to_dense()
        self.idf=torch.log((1+len(self.train_all))/(1+df))+1
        self.idf_cpu=self.idf.tolist()
        self.pool_weights=[{p:self.idf_cpu[p]*self.frequency[d][p] for p in row} for d,row in enumerate(self.profiles)]
        self.pool=sparse(self.profiles,self.np,self.device,self.pool_weights)
        strict_weights=[self.pool_weights[i] if trainrows[i] else {} for i in range(self.nd)]
        self.strict_pool=sparse(trainrows,self.np,self.device,strict_weights)
        idx=self.graph['train_incidence_index']
        take=idx[0]>=self.nd
        self.incidence=torch.stack((idx[0,take]-self.nd,idx[1,take])).to(self.device)
        assert set(idx[1].tolist()).issubset(set(self.train_all))
        self.train_ids=torch.tensor(self.split['train'],device=self.device)
        self.known=torch.tensor([d in trainset for d in range(self.nd)],device=self.device)
        self.manifest=json.loads((ROOT/'data/metadata/dataset_manifest.json').read_text())

    def queries(self,ids,fraction=.5,seed=20261026,noise=False):
        rows=[]
        for d in ids:
            # Each case mask is independent of batching and model seed.
            rng=random.Random(f'{seed}:{self.diseases[d]}:{fraction}')
            ordered=sorted(self.profiles[d]);rng.shuffle(ordered)
            observed=set(ordered[:max(1,int(len(ordered)*fraction))])
            if noise:
                for _ in range(max(1,int(.2*len(observed)))):
                    p=rng.randrange(self.np)
                    while p in self.profiles[d] or p in self.absent[d] or p in observed:p=rng.randrange(self.np)
                    observed.add(p)
            rows.append(observed)
        return sparse(rows,self.np,self.device),rows

    def observation_matrix(self,present,absent=(),unknown=()):
        states=[set(present),set(absent),set(unknown)]
        if any(states[i]&states[j] for i in range(3) for j in range(i)):raise ValueError('Conflicting observations')
        if any(p<0 or p>=self.np for s in states for p in s):raise ValueError('Unknown phenotype index')
        return sparse([states[0]],self.np,self.device)

    def matching(self,obs,strict=False):
        ref=self.strict_reference if strict else self.reference
        dense=obs.to_dense()
        overlap=torch.sparse.mm(ref,dense.T).T/dense.sum(1,keepdim=True).clamp_min(1)
        weighted=torch.sparse.mm(ref,(dense*self.idf).T).T/(dense*self.idf).sum(1,keepdim=True).clamp_min(1)
        return overlap,weighted

    def weighted_observations(self,obs):
        return torch.sparse_coo_tensor(obs.indices(),obs.values()*self.idf[obs.indices()[1]],obs.shape,check_invariants=True).coalesce()


def sample_negatives(overlap,labels,allowed,n_hard=16,n_random=16):
    """Compatible supersets and true label are never training negatives."""
    valid=overlap[:,allowed]<1-1e-6
    valid &= allowed[None,:]!=labels[:,None]
    hard=overlap[:,allowed].masked_fill(~valid,-torch.inf).topk(min(n_hard,len(allowed)),dim=1).indices
    hard_ids=allowed[hard]
    random_ids=allowed[torch.randint(len(allowed),(len(labels),n_random),device=labels.device)]
    neg=torch.cat((hard_ids,random_ids),1)
    mask=(overlap.gather(1,neg)<1-1e-6)&(neg!=labels[:,None])
    return neg,mask


def tied_statistics(scores,labels):
    """Scores are higher-is-better; integrate uniformly over tied positions."""
    target=scores.gather(1,labels[:,None])
    tied=torch.isclose(scores,target,rtol=1e-6,atol=1e-7)
    better=((scores>target)&~tied).sum(1);ties=tied.sum(1).clamp_min(1)
    h=torch.cat((torch.zeros(1,device=scores.device),torch.arange(1,scores.shape[1]+1,device=scores.device,dtype=torch.float64).reciprocal().cumsum(0)))
    result={f'top_{k}':((k-better).float()/ties).clamp(0,1) for k in (1,3,5,10)}
    result['mrr']=((h[better+ties]-h[better])/ties).float()
    result['mean_rank']=better.float()+(ties.float()+1)/2
    return result


def aggregate(stats,groups=None,bootstrap=500,seed=907):
    result={key:value.mean().item() for key,value in stats.items()}
    result['queries']=len(stats['mrr'])
    for k in (1,3,5,10):
        if f'top_{k}' in result:result[f'recall@{k}']=result[f'top_{k}']
    if groups is not None:
        # Cluster bootstrap preserves diseases sharing an identity group.
        unique={g:i for i,g in enumerate(sorted(set(groups)))}
        idx=torch.tensor([unique[g] for g in groups],device=stats['mrr'].device)
        count=torch.bincount(idx,minlength=len(unique)).float()
        generator=torch.Generator(device=idx.device).manual_seed(seed)
        resamples=torch.randint(len(unique),(bootstrap,len(unique)),device=idx.device,generator=generator)
        intervals={}
        for key in ('top_1','mrr'):
            sums=torch.zeros(len(unique),device=idx.device).index_add_(0,idx,stats[key])
            estimates=sums[resamples].sum(1)/count[resamples].sum(1)
            intervals[key]=torch.quantile(estimates,torch.tensor([.025,.975],device=idx.device)).tolist()
        result['ci95_identity_cluster_bootstrap']=intervals
    return result
