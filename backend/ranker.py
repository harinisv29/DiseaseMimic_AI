"""Research integration API for validation-selected ranking and next observations."""
from scripts.runtime import ROOT,require_cuda
import json
import torch
from architecture_data import Corpus,OUT
from improve_architecture import Experiment,standardize
from models.profile_hgnn import ProfileHGNN
from observation_recommendation import recommend


class DiseaseRanker:
    def __init__(self):
        self.device=require_cuda()
        self.c=Corpus()
        checkpoint=torch.load(OUT/'best_model.pt',map_location=self.device,weights_only=True)
        if checkpoint['data_sha256']!=self.c.manifest['processed_sha256']:
            raise RuntimeError('Checkpoint data fingerprint mismatch')
        if checkpoint['disease_ids']!=self.c.diseases or checkpoint['phenotype_ids']!=self.c.phenotypes:
            raise RuntimeError('Checkpoint identifier ordering mismatch')
        self.model=ProfileHGNN(self.c.np,checkpoint['hidden']).to(self.device)
        self.model.load_state_dict(checkpoint['state_dict']);self.model.eval()
        self.experiment=Experiment(self.c,self.model)
        self.decision=json.loads((OUT/'inference_config.json').read_text())
        with torch.no_grad():self.representations=self.experiment.representations()

    @torch.no_grad()
    def rank(self,present,absent=(),unknown=(),available=None,limit=10):
        c=self.c
        def ids(values):
            invalid=set(values)-c.pi.keys()
            if invalid:raise ValueError('Unsupported HPO IDs: '+', '.join(sorted(invalid)))
            return {c.pi[p] for p in values}
        p,a,u=ids(present),ids(absent),ids(unknown)
        if not p:raise ValueError('At least one present phenotype is required')
        if not 1<=limit<=c.nd:raise ValueError('Invalid result limit')
        availability=None if available is None else ids(available)
        obs=c.observation_matrix(p,a,u)
        scores=self.experiment.scores(obs,self.representations)
        h=self.decision['hybrid']
        scores['hybrid']=scores[h['baseline']]+h['weight']*standardize(scores['hgnn_ebm'])
        score=scores[self.decision['default_method']][0]
        # Stable tie order for display; evaluation integrates over uniform ties.
        order=torch.argsort(score,descending=True,stable=True)
        candidates=order[:20].tolist()
        posterior=torch.softmax(score[candidates]/.1,dim=0)
        rankings=[]
        for i in order[:limit].tolist():
            tied=torch.isclose(score,score[i],rtol=1e-6,atol=1e-7)
            better=((score>score[i])&~tied).sum().item()
            rankings.append(dict(disease_id=c.diseases[i],score=score[i].item(),
                best_tied_rank=int(better+1),worst_tied_rank=int(better+tied.sum().item())))
        return dict(method=self.decision['default_method'],device=str(self.device),rankings=rankings,
            next_observations=recommend(c,candidates,posterior,p,a,u,availability),
            observations=dict(present=sorted(present),absent=sorted(absent),unknown=sorted(unknown)),
            note='Exploratory known-profile research ranking; score is not probability. Unrecorded phenotypes remain unknown. Rankings use present observations; known absent states exclude completed observations from recommendations, while unknown states remain eligible for reassessment.')
