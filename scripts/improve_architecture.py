"""CUDA-only training and fair, disjoint-label reference-profile evaluation."""
import argparse
import csv
import hashlib
import json
import random
import time
from runtime import ROOT,require_cuda
import torch
from torch.nn import functional as F
from architecture_data import Corpus,OUT,METHODS,aggregate,tied_statistics,sample_negatives,write_json
from models.profile_hgnn import ProfileHGNN


def standardize(x):
    return (x-x.mean(1,keepdim=True))/x.std(1,keepdim=True,unbiased=False).clamp_min(1e-5)


class Experiment:
    def __init__(self,corpus,model,batch=32):
        self.c=corpus;self.model=model;self.batch=batch
        self.mixed=torch.cuda.is_bf16_supported()

    def representations(self,strict=False):
        raw,graph=self.model.encode(self.c.incidence,self.c.nd)
        matrix=self.c.strict_pool if strict else self.c.pool
        return raw,graph,self.model.pool(matrix,raw),self.model.pool(matrix,graph)

    def pair_energy(self,head,q,d):
        with torch.autocast('cuda',dtype=torch.bfloat16,enabled=self.mixed):
            return head(q,d).float()

    def scores(self,obs,reps,strict=False):
        raw,graph,dr,dg=reps
        weighted=self.c.weighted_observations(obs)
        qr=self.model.pool(weighted,raw);qg=self.model.pool(weighted,graph)
        overlap,wm=self.c.matching(obs,strict)
        hg=qg@dg.T
        er=[];eg=[]
        for start in range(0,self.c.nd,2048):
            r=dr[start:start+2048];g=dg[start:start+2048]
            er.append(-self.pair_energy(self.model.raw_energy,qr[:,None,:].expand(-1,len(r),-1),r[None].expand(len(qr),-1,-1)))
            eg.append(-self.pair_energy(self.model.graph_energy,qg[:,None,:].expand(-1,len(g),-1),g[None].expand(len(qg),-1,-1)))
        result=dict(overlap=overlap,weighted=wm,hgnn=hg,ebm=torch.cat(er,1),hgnn_ebm=torch.cat(eg,1))
        if strict:
            for name in ('hgnn','ebm','hgnn_ebm'):result[name][:,~self.c.known]=0
        return result

    @torch.no_grad()
    def evaluate(self,ids,fraction=.5,noise=False,strict=False,hybrid=None,ci=False,return_stats=False):
        self.model.eval();reps=self.representations(strict)
        chunks={m:[] for m in METHODS if m!='hybrid' or hybrid is not None}
        unseen_chunks={m:[] for m in chunks} if strict else None
        unseen_ids=torch.where(~self.c.known)[0] if strict else None
        inverse=torch.full((self.c.nd,),-1,device=self.c.device,dtype=torch.long) if strict else None
        if strict:inverse[unseen_ids]=torch.arange(len(unseen_ids),device=self.c.device)
        for start in range(0,len(ids),self.batch):
            batch=ids[start:start+self.batch];obs,_=self.c.queries(batch,fraction,noise=noise)
            scores=self.scores(obs,reps,strict)
            if hybrid is not None:scores['hybrid']=scores[hybrid['baseline']]+hybrid['weight']*standardize(scores['hgnn_ebm'])
            labels=torch.tensor(batch,device=self.c.device)
            for method in chunks:
                chunks[method].append(tied_statistics(scores[method],labels))
                if strict:unseen_chunks[method].append(tied_statistics(scores[method][:,unseen_ids],inverse[labels]))
        stats={m:{k:torch.cat([part[k] for part in v]) for k in v[0]} for m,v in chunks.items()}
        groups=[self.c.groups[d] for d in ids] if ci else None
        result={m:aggregate(st,groups) for m,st in stats.items()}
        if strict:
            result={'all_candidates':result,'unseen_only':{m:aggregate({k:torch.cat([p[k] for p in v]) for k in v[0]},groups) for m,v in unseen_chunks.items()},'unseen_candidates':len(unseen_ids)}
        return (result,stats) if return_stats else result

    @torch.no_grad()
    def tune_hybrid(self):
        self.model.eval();reps=self.representations()
        grid=[(b,a) for b in ('overlap','weighted') for a in (0.,.01,.03,.1,.3,1.)]
        sums={x:0. for x in grid};n=0
        for start in range(0,len(self.c.split['validation']),self.batch):
            batch=self.c.split['validation'][start:start+self.batch]
            obs,_=self.c.queries(batch);scores=self.scores(obs,reps)
            neural=standardize(scores['hgnn_ebm']);labels=torch.tensor(batch,device=self.c.device)
            for b,a in grid:sums[b,a]+=tied_statistics(scores[b]+a*neural,labels)['mrr'].sum().item()
            n+=len(batch)
        choice=max(grid,key=lambda x:sums[x])
        return dict(baseline=choice[0],weight=choice[1],validation_mrr=sums[choice]/n,grid=[dict(baseline=b,weight=a,mrr=sums[b,a]/n) for b,a in grid])


def train_seed(c,seed,args):
    torch.manual_seed(seed);torch.cuda.manual_seed_all(seed);random.seed(seed)
    model=ProfileHGNN(c.np,args.hidden).to(c.device)
    exp=Experiment(c,model)
    optimizer=torch.optim.AdamW(model.parameters(),lr=.002,weight_decay=.001)
    scheduler=torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer,mode='max',patience=5,factor=.5)
    best=-1.;best_epoch=0;stale=0;history=[];started=time.perf_counter()
    folder=OUT/f'seed-{seed}';folder.mkdir(exist_ok=True)
    for epoch in range(1,args.epochs+1):
        tick=time.perf_counter();model.train();optimizer.zero_grad(set_to_none=True)
        raw,graph,dr,dg=exp.representations(strict=True)
        order=torch.randperm(len(c.train_ids),device=c.device).tolist()
        ids=[c.split['train'][i] for i in order];total=0.;neg_count=0
        for start in range(0,len(ids),args.batch_size):
            batch=ids[start:start+args.batch_size]
            fraction=(.25,.5,.75)[(epoch+start//args.batch_size)%3]
            obs,_=c.queries(batch,fraction,seed=seed+epoch*1000)
            weighted=c.weighted_observations(obs)
            qr=model.pool(weighted,raw);qg=model.pool(weighted,graph)
            overlap,_=c.matching(obs,strict=True)
            labels=torch.tensor(batch,device=c.device)
            negative,mask=sample_negatives(overlap,labels,c.train_ids)
            candidates=torch.cat((labels[:,None],negative),1)
            # Positive label is index zero in each query-specific candidate set.
            lraw=-exp.pair_energy(model.raw_energy,qr[:,None,:].expand(-1,candidates.shape[1],-1),dr[candidates])/.1
            lgraph=-exp.pair_energy(model.graph_energy,qg[:,None,:].expand(-1,candidates.shape[1],-1),dg[candidates])/.1
            cosine=(qg[:,None,:]*dg[candidates]).sum(-1)/.1
            allowed=torch.cat((torch.ones(len(batch),1,device=c.device,dtype=torch.bool),mask),1)
            y=torch.zeros(len(batch),device=c.device,dtype=torch.long)
            loss=.4*F.cross_entropy(lraw.masked_fill(~allowed,-1e4),y)+.4*F.cross_entropy(lgraph.masked_fill(~allowed,-1e4),y)+.2*F.cross_entropy(cosine.masked_fill(~allowed,-1e4),y)
            if not torch.isfinite(loss):raise RuntimeError('Nonfinite CUDA loss')
            (loss*len(batch)/len(ids)).backward(retain_graph=start+args.batch_size<len(ids))
            total+=loss.item()*len(batch);neg_count+=mask.sum().item()
        assert neg_count>0
        assert all(p.is_cuda and p.grad is not None and p.grad.is_cuda and torch.isfinite(p.grad).all() for p in model.parameters())
        torch.nn.utils.clip_grad_norm_(model.parameters(),5,error_if_nonfinite=True)
        optimizer.step()
        del raw,graph,dr,dg,qr,qg,lraw,lgraph,cosine,loss
        val=exp.evaluate(c.split['validation'])
        objective=sum(val[m]['mrr'] for m in ('hgnn','ebm','hgnn_ebm'))/3
        scheduler.step(objective)
        if objective>best+1e-5:
            best=objective;best_epoch=epoch;stale=0
            torch.save(dict(state_dict=model.state_dict(),optimizer=optimizer.state_dict(),scheduler=scheduler.state_dict(),
                n_phenotypes=c.np,hidden=args.hidden,seed=seed,epoch=epoch,validation_objective=best,
                data_sha256=c.manifest['processed_sha256'],architecture='inductive_profile_hgnn_v1',disease_ids=c.diseases,phenotype_ids=c.phenotypes),folder/'best_model.pt')
            write_json(folder/'validation_metrics.json',val)
        else:stale+=1
        torch.cuda.synchronize()
        record=dict(seed=seed,epoch=epoch,loss=total/len(ids),validation_objective=objective,
            validation_hgnn_mrr=val['hgnn']['mrr'],validation_ebm_mrr=val['ebm']['mrr'],validation_hgnn_ebm_mrr=val['hgnn_ebm']['mrr'],
            lr=optimizer.param_groups[0]['lr'],seconds=time.perf_counter()-tick,gpu_allocated=torch.cuda.memory_allocated(),gpu_peak=torch.cuda.max_memory_allocated())
        history.append(record)
        with (folder/'training_history.csv').open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(record));writer.writeheader();writer.writerows(history)
        if epoch==1 or epoch%5==0:print(json.dumps(record),flush=True)
        if stale>=15:break
    duration=time.perf_counter()-started
    checkpoint=torch.load(folder/'best_model.pt',weights_only=True,map_location=c.device)
    model.load_state_dict(checkpoint['state_dict']);model.eval()
    summary=dict(seed=seed,epochs=epoch,best_epoch=best_epoch,validation_objective=best,training_seconds=duration)
    write_json(folder/'training_summary.json',summary)
    return summary


def paired_difference(model_stats,base_stats,c,ids):
    delta=model_stats['mrr']-base_stats['mrr']
    st={k:delta for k in ('top_1','mrr')}
    result=aggregate(st,[c.groups[d] for d in ids])
    return dict(mean=result['mrr'],ci95=result['ci95_identity_cluster_bootstrap']['mrr'])


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--epochs',type=int,default=150);ap.add_argument('--batch-size',type=int,default=256);ap.add_argument('--hidden',type=int,default=64);ap.add_argument('--seeds',nargs='+',type=int,default=[42,43,44]);ap.add_argument('--evaluate-only',action='store_true');args=ap.parse_args()
    if not 1<=args.epochs<=150 or args.batch_size<1:ap.error('Invalid training configuration')
    require_cuda();torch.set_num_threads(4);torch.cuda.reset_peak_memory_stats()
    OUT.mkdir(exist_ok=True,parents=True)
    from validate_datasets import validate
    validate()
    c=Corpus()
    config=vars(args)|dict(cuda=torch.version.cuda,torch=torch.__version__,gpu=torch.cuda.get_device_name(0),device=str(c.device),patience=15,
        mixed_precision='BF16 dense MLP; FP32 sparse propagation' if torch.cuda.is_bf16_supported() else 'FP32',split_counts={s:len(v) for s,v in c.split.items()},data_sha256=c.manifest['processed_sha256'])
    if not args.evaluate_only:write_json(OUT/'training_config.json',config)
    summaries=([json.loads((OUT/f'seed-{seed}'/'training_summary.json').read_text()) for seed in args.seeds] if args.evaluate_only else [train_seed(c,seed,args) for seed in args.seeds])
    chosen=max(summaries,key=lambda s:s['validation_objective'])
    checkpoint=torch.load(OUT/f"seed-{chosen['seed']}"/'best_model.pt',weights_only=True,map_location=c.device)
    if not args.evaluate_only:torch.save(checkpoint,OUT/'best_model.pt')
    else:
        saved=torch.load(OUT/'best_model.pt',weights_only=True,map_location=c.device)
        assert saved['seed']==checkpoint['seed'] and saved['epoch']==checkpoint['epoch']
    model=ProfileHGNN(c.np,args.hidden).to(c.device);model.load_state_dict(checkpoint['state_dict']);exp=Experiment(c,model)
    hybrid=exp.tune_hybrid();write_json(OUT/'hybrid_selection.json',hybrid)
    validation=exp.evaluate(c.split['validation'],hybrid=hybrid,ci=True)
    baseline=max(('overlap','weighted'),key=lambda m:validation[m]['mrr'])
    winner=max(METHODS,key=lambda m:validation[m]['mrr'])
    default=winner if validation[winner]['mrr']>validation[baseline]['mrr']+.001 else baseline
    decision=dict(default_method=default,best_baseline=baseline,hybrid=hybrid,selected_seed=chosen['seed'],best_epoch=chosen['best_epoch'],selection='Validation only; >=.001 MRR gain required to replace baseline')
    write_json(OUT/'inference_config.json',decision);write_json(OUT/'validation_metrics.json',validation)
    # Test access starts ONLY after weight, seed and default method selection.
    test={};all_stats={}
    for fraction in (1.,.75,.5,.25):
        key=str(fraction)
        test[key],all_stats[key]=exp.evaluate(c.split['test'],fraction,hybrid=hybrid,ci=True,return_stats=True)
    noisy=exp.evaluate(c.split['test'],.5,noise=True,hybrid=hybrid,ci=True)
    strict=exp.evaluate(c.split['test'],.5,strict=True,hybrid=hybrid,ci=True)
    comparisons={m:paired_difference(all_stats['0.5'][m],all_stats['0.5'][baseline],c,c.split['test']) for m in METHODS}
    result=dict(status='exploratory',setting_A=test,setting_A_injected_observations_at_50_percent=noisy,setting_B=strict,paired_mrr_difference_vs_validation_selected_baseline=comparisons)
    write_json(OUT/'test_metrics.json',result)
    with (OUT/'baseline_comparison.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['setting','retention','method','top_1','top_3','top_5','mrr','mean_rank']);writer.writeheader()
        for fraction,methods in test.items():
            for m,v in methods.items():writer.writerow(dict(setting='A',retention=fraction,method=m,**{k:v[k] for k in ('top_1','top_3','top_5','mrr','mean_rank')}))
        for m,v in strict['all_candidates'].items():writer.writerow(dict(setting='B_all_candidates',retention=.5,method=m,**{k:v[k] for k in ('top_1','top_3','top_5','mrr','mean_rank')}))
    seed_results=[]
    for s in summaries:
        ck=torch.load(OUT/f"seed-{s['seed']}"/'best_model.pt',weights_only=True,map_location=c.device)
        model.load_state_dict(ck['state_dict'])
        seed_results.append(s|dict(test_50_percent=exp.evaluate(c.split['test'],.5)))
    write_json(OUT/'seed_comparison.json',seed_results)
    model.load_state_dict(checkpoint['state_dict'])
    from observation_recommendation import evaluate_recommendations
    recommendations=evaluate_recommendations(c,exp,decision)
    write_json(OUT/'observation_recommendation_metrics.json',recommendations)
    write_json(OUT/'training_summary.json',dict(seeds=summaries,selected=chosen,total_training_seconds=sum(s['training_seconds'] for s in summaries),peak_gpu_bytes=torch.cuda.max_memory_allocated()))
    with (OUT/'training_history.csv').open('w',newline='') as f:
        writer=None
        for s in summaries:
            with (OUT/f"seed-{s['seed']}"/'training_history.csv').open() as source:
                reader=csv.DictReader(source)
                if writer is None:writer=csv.DictWriter(f,fieldnames=reader.fieldnames);writer.writeheader()
                writer.writerows(reader)
    preserved=json.loads((OUT/'preserved_checkpoints.json').read_text())
    assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in preserved.items())
    make_report(config,summaries,chosen,decision,validation,result,recommendations)
    print(json.dumps(dict(selected=chosen,default=default,test_50_percent=test['0.5'],recommendations=recommendations)),flush=True)


def make_report(config,summaries,chosen,decision,val,result,recs):
    lines=['# Architecture improvement research report','','Results are exploratory source-profile retrieval experiments, not independent patient or clinical validation. Prior test aggregates motivated redesign.','',
        '## Diagnosis','',
        'The old model depended on untrained held-out disease-ID embeddings and compared them with a baseline allowed to see held-out reference profiles. No mapping or energy-direction reversal was found. Tie metrics and validation selection were corrected. See diagnostic_report.md for the pre-change audit.',
        '', '## CUDA training','',f"GPU: {config['gpu']}; CUDA {config['cuda']}; {config['mixed_precision']}.",
        f"Three-seed training duration: {sum(s['training_seconds'] for s in summaries):.2f} seconds (optimization, validation, checkpointing).",
        f"Selected seed {chosen['seed']}; best epoch {chosen['best_epoch']}; epochs run per seed: {[s['epochs'] for s in summaries]}.",
        f"Peak GPU allocation: {torch.cuda.max_memory_allocated()/2**20:.2f} MiB. Original checkpoints preserved by SHA256.",
        '', '## Setting A: known reference profiles, 50% retained phenotypes','',
        'All six methods use the same candidate profiles and observations. HGNN propagation and model optimization see training diseases only. Inference encodes permitted reference profiles without disease-ID parameters.','',
        '| Model | Top-1 | Top-3 | Top-5 | MRR |','|---|---:|---:|---:|---:|']
    for m,v in result['setting_A']['0.5'].items():lines.append(f"| {m} | {100*v['top_1']:.3f}% | {100*v['top_3']:.3f}% | {100*v['top_5']:.3f}% | {v['mrr']:.6f} |")
    lines += ['',f"Default method from validation only: **{decision['default_method']}**; hybrid baseline {decision['hybrid']['baseline']}, weight {decision['hybrid']['weight']}.",
        f"Validation best matching baseline MRR: {val[decision['best_baseline']]['mrr']:.6f}; hybrid MRR: {val['hybrid']['mrr']:.6f}.",
        '', 'Paired test MRR difference from validation-selected matching baseline (95% identity-cluster bootstrap CI):','']
    for m,v in result['paired_mrr_difference_vs_validation_selected_baseline'].items():lines.append(f"- {m}: {v['mean']:.6f}, CI {v['ci95']}.")
    delta=result['paired_mrr_difference_vs_validation_selected_baseline']['hybrid']
    lines += ['',f"Hybrid adds a statistically resolved MRR gain under this bootstrap: {delta['ci95'][0]>0}.",
        'HGNN alone, raw EBM and HGNN+EBM ablations are reported separately; compare hgnn_ebm versus ebm before attributing benefit to hypergraph message passing.',
        '', '## Setting B: strict reference-withheld disease generalization','',
        f"All methods are denied held-out candidate associations. There are {result['setting_B']['unseen_candidates']} unseen candidates with identical empty representations. Unseen-only results cannot distinguish their labels; all-candidate and unseen-only metrics are in test_metrics.json. This is an information limit, not solved by assigning random disease IDs.",
        '', '## Robustness and uncertainty','',
        'test_metrics.json includes every method at 100%,75%,50%,25% retention, unsupported injected phenotypes, Top-1/3/5, Recall@1/3/5/10, mean rank, MRR, bootstrap intervals and paired differences. seed_comparison.json reports three independent seeds. Test cases and condition seeds are fixed before training. Synthetic observations are not patient data.',
        '', '## Next-observation simulation','',f"{json.dumps(recs,indent=2)}",'',
        'Frequency intervals use source evidence; unknown candidate annotations remain p=.5. The simulator conditions on target-in-top20 and oracle ascertainable annotations. Entropy changes can be negative for individual outcomes. This evaluates simulated ambiguity only and establishes no clinical utility.',
        '', '## Integration status','',
        'The selected ranking method and observation recommender are available through scripts/predict_improved.py. CUDA is mandatory. Absent/unknown states and availability are explicit. Default selection is based on validation; neural complexity alone never triggers deployment. The backend is ready for research integration; there is no completed frontend dashboard or clinical readiness claim.']
    (OUT/'final_research_report.md').write_text('\n'.join(lines),encoding='utf-8')

if __name__=='__main__':main()
