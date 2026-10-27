"""Frequency-aware Bayesian next-observation selection; unknown is never absent."""
import random
import torch


def entropy(p,dim=-1):
    return -(p*p.clamp_min(1e-12).log()).sum(dim)


def recommendation_values(c,candidates,posterior,present=(),absent=(),unknown=(),available=None):
    """Availability is explicit. Unknown observed terms remain eligible for reassessment."""
    if not posterior.is_cuda:raise RuntimeError('CUDA is required')
    known=set(present)|set(absent)
    if set(present)&set(absent):raise ValueError('Conflicting phenotype states')
    universe=set().union(*(c.profiles[d]|c.absent[d] for d in candidates))
    options=sorted((universe if available is None else universe&set(available))-known)
    if not options:return [],None,None,None
    # Unrecorded pairs stay maximally uncertain. No zero-filled absence assumption.
    values=[]
    for d in candidates:
        values.append([.01 if p in c.absent[d] else c.frequency[d].get(p,.5) for p in options])
    prob=torch.tensor(values,device=posterior.device).clamp(.01,.99)
    mean=(posterior[:,None]*prob).sum(0)
    binary=-(prob*prob.log()+(1-prob)*(1-prob).log())
    predictive=-(mean*mean.log()+(1-mean)*(1-mean).log())
    information=(predictive-(posterior[:,None]*binary).sum(0)).clamp_min(0)
    return options,prob,mean,information


def recommend(c,candidates,posterior,present=(),absent=(),unknown=(),available=None,limit=5):
    options,prob,mean,information=recommendation_values(c,candidates,posterior,present,absent,unknown,available)
    if not options:return []
    chosen=information.topk(min(limit,len(options))).indices.tolist()
    return [dict(phenotype_id=c.phenotypes[options[i]],expected_information_gain_nats=information[i].item(),
        predictive_present_probability=mean[i].item(),reassessment=options[i] in set(unknown),
        availability='permitted',note='Simulation model; unrecorded candidate annotations remain unknown') for i in chosen]


@torch.no_grad()
def evaluate_recommendations(c,experiment,decision):
    model=experiment.model;model.eval();reps=experiment.representations()
    rows={p:[] for p in ('information_gain','random','frequency')}
    considered=min(200,len(c.split['test']));eligible=0
    generator=torch.Generator(device=c.device).manual_seed(6671)
    for d in c.split['test'][:considered]:
        obs,observed=c.queries([d],.5)
        scores=experiment.scores(obs,reps)
        if decision['default_method']=='hybrid':
            from improve_architecture import standardize
            scores['hybrid']=scores[decision['hybrid']['baseline']]+decision['hybrid']['weight']*standardize(scores['hgnn_ebm'])
        score=scores[decision['default_method']][0]
        candidates=score.topk(20).indices.tolist()
        if d not in candidates:continue
        known=observed[0]
        available=(c.profiles[d]|c.absent[d])-known
        posterior=torch.softmax(score[candidates]/.1,dim=0)
        options,prob,pmean,information=recommendation_values(c,candidates,posterior,present=known,available=available)
        if not options:continue
        eligible+=1;target=candidates.index(d)
        base_entropy=entropy(posterior);base_effective=base_entropy.exp()
        for policy in rows:
            if policy=='information_gain':ix=information.argmax().expand(32)
            elif policy=='frequency':ix=pmean.argmax().expand(32)
            else:ix=torch.randint(len(options),(32,),device=c.device,generator=generator)
            true_probability=prob[target,ix]
            outcome=torch.rand(32,device=c.device,generator=generator)<true_probability
            likelihood=torch.where(outcome[:,None],prob[:,ix].T,1-prob[:,ix].T)
            updated=posterior[None,:]*likelihood
            updated/=updated.sum(1,keepdim=True)
            after=entropy(updated)
            rows[policy].append(torch.stack(((base_entropy-after).mean(),(base_effective-after.exp()).mean(),(updated[:,target]-posterior[target]).mean())))
    results={}
    for policy,values in rows.items():
        if not values:results[policy]=dict(queries=0);continue
        matrix=torch.stack(values)
        results[policy]=dict(queries=len(values),mean_entropy_reduction_nats=matrix[:,0].mean().item(),
            mean_effective_candidate_reduction=matrix[:,1].mean().item(),mean_true_target_posterior_change=matrix[:,2].mean().item())
    comparisons={}
    if eligible:
        eig=torch.stack(rows['information_gain'])[:,0]
        for policy in ('random','frequency'):
            delta=eig-torch.stack(rows[policy])[:,0]
            resamples=torch.randint(eligible,(500,eligible),device=c.device,generator=generator)
            intervals=torch.quantile(delta[resamples].mean(1),torch.tensor([.025,.975],device=c.device))
            comparisons[policy]=dict(paired_mean_entropy_gain=delta.mean().item(),ci95=intervals.tolist())
    return dict(considered=considered,eligible_target_in_top20_with_available_annotation=eligible,replicates_per_case=32,
        policies=results,paired_entropy_improvement=comparisons,
        limitations=['Conditional on target in top20; oracle availability uses remaining explicitly annotated target terms for all policies.',
        'Binary outcomes simulated from source frequency or documented .75 positive/.01 absent assumptions.',
        'Unrecorded candidate phenotype pairs use .5 unknown, never absent; synthetic uncertainty model may be miscalibrated.',
        'Entropy reduction is model-based and does not establish clinical usefulness.'])
