"""CUDA-only full-graph HGNN training and disease-disjoint ranking evaluation."""
import argparse
import csv
import json
import random
import time
from pathlib import Path
from runtime import ROOT, require_cuda
import torch
from models.hgnn_ebm import EnergyModel
from preprocess_datasets import read_csv
from validate_datasets import validate

OUT = ROOT/'runs/final-gpu-training'

def dump(name, value):
    (OUT/name).write_text(json.dumps(value, indent=2), encoding='utf-8')

def metrics(ranks):
    r = torch.cat(ranks).float()
    result = {f'top_{k}_accuracy': (r<=k).float().mean().item() for k in (1,3,5)}
    result.update({f'recall@{k}': (r<=k).float().mean().item() for k in (1,3,5,10)})
    result.update(mrr=r.reciprocal().mean().item(), mean_rank=r.mean().item(), queries=r.numel())
    return result

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--epochs', type=int, default=150)
    ap.add_argument('--batch-size', type=int, default=256)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--patience', type=int, default=15)
    ap.add_argument('--device', choices=['cuda'], default='cuda')
    args=ap.parse_args()
    if not 1<=args.epochs<=150 or args.batch_size<1 or args.patience<1:
        ap.error('epochs must be 1..150; batch size and patience must be positive')
    device=require_cuda()
    torch.set_num_threads(4)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    random.seed(args.seed)
    torch.backends.cudnn.benchmark=False
    torch.cuda.reset_peak_memory_stats()
    OUT.mkdir(parents=True,exist_ok=True)
    validate()
    graph=torch.load(ROOT/'data/processed/hypergraph_data.pt', weights_only=True, map_location='cpu')
    nd=len(graph['disease_ids']); np=len(graph['phenotype_ids'])
    di={v:i for i,v in enumerate(graph['disease_ids'])}
    pi={v:i for i,v in enumerate(graph['phenotype_ids'])}
    rows=read_csv('disease_phenotype.csv')
    absent={(r['disease_id'],r['phenotype_id']) for r in rows if r['state']=='absent'}
    profiles=[set() for _ in range(nd)]
    for r in rows:
        if r['state']=='present' and (r['disease_id'],r['phenotype_id']) not in absent:
            profiles[di[r['disease_id']]].add(pi[r['phenotype_id']])
    splits={s:[i for i,p in enumerate(profiles) if len(p)>=2 and graph['disease_split'][graph['disease_ids'][i]]==s] for s in ('train','validation','test')}
    assert all(splits.values())
    incidence=graph['train_incidence_index'].to(device)
    assert set(graph['train_incidence_index'][1].tolist()).issubset(set(splits['train']) | {i for i,p in enumerate(profiles) if len(p)<2 and graph['disease_split'][graph['disease_ids'][i]]=='train'})
    manifest=json.loads((ROOT/'data/metadata/dataset_manifest.json').read_text())
    original=torch.load(ROOT/'models/hgnn_ebm.pt',weights_only=True,map_location='cpu')
    assert original['data_sha256']==manifest['processed_sha256']
    model=EnergyModel(graph['num_nodes'],original['hidden']).to(device)
    model.load_state_dict(original['state_dict'])
    optimizer=torch.optim.AdamW(model.parameters(),lr=0.002,weight_decay=0.001)
    scheduler=torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer,patience=5,factor=0.5)
    # Sparse reference matrix is used ONLY by the annotation-overlap baseline and
    # negative filtering, never as HGNN input. Includes held-out reference catalogs.
    rr=[]; cc=[]
    for i,p in enumerate(profiles):
        for j in sorted(p): rr.append(i); cc.append(j)
    reference=torch.sparse_coo_tensor(torch.tensor([rr,cc],device=device),torch.ones(len(rr),device=device),(nd,np)).coalesce()
    train_ids=torch.tensor(splits['train'],device=device)
    bf16=torch.cuda.is_bf16_supported()
    config=vars(args)|dict(device=str(device),gpu=torch.cuda.get_device_name(0),torch=torch.__version__,cuda=torch.version.cuda,
        free_vram_bytes=torch.cuda.mem_get_info()[0],total_vram_bytes=torch.cuda.mem_get_info()[1],precision='BF16 energy MLP; FP32 sparse HGNN' if bf16 else 'FP32',initial_checkpoint='models/hgnn_ebm.pt',initial_epochs=original['epochs'],
        split_counts={s:len(v) for s,v in splits.items()},evaluation='Disease-disjoint cold start; all diseases are ranking candidates. Source profiles, not patient cases.',
        baseline='Count shared observed phenotypes against complete reference catalog; held-out profiles available to baseline only. Ties use average rank.',data_sha256=manifest['processed_sha256'])
    dump('training_config.json',config)
    # Real CUDA forward AND backward through both networks before optimization.
    x=model.hgnn(incidence,graph['num_hyperedges'])
    probe=model.score(x[nd:nd+2],x[:2]).sum()
    probe.backward()
    assert all(p.is_cuda for p in model.parameters())
    assert all(p.grad is not None and p.grad.is_cuda and torch.isfinite(p.grad).all() for p in model.parameters())
    model.zero_grad(set_to_none=True)
    del x,probe

    def queries(ids, fraction, seed):
        rng=random.Random(seed)
        ii=[]; jj=[]
        for b,d in enumerate(ids):
            selected=rng.sample(sorted(profiles[d]),max(1,int(len(profiles[d])*fraction)))
            ii.extend([b]*len(selected)); jj.extend(selected)
        idx=torch.tensor([ii,jj],device=device)
        counts=torch.bincount(idx[0],minlength=len(ids)).float()
        return torch.sparse_coo_tensor(idx,torch.ones(len(ii),device=device)/counts[idx[0]],(len(ids),np)).coalesce()

    def energy(q,d):
        with torch.autocast('cuda',dtype=torch.bfloat16,enabled=bf16):
            return model.score(q,d).float()

    @torch.no_grad()
    def evaluate(ids, fraction=.5, baseline=False):
        model.eval()
        emb=model.hgnn(incidence,graph['num_hyperedges'])
        ranks=[]; branks=[]; losses=[]
        for start in range(0,len(ids),min(args.batch_size,32)):
            batch=ids[start:start+min(args.batch_size,32)]
            obs=queries(batch,fraction,args.seed+start)
            q=torch.sparse.mm(obs,emb[nd:])
            labels=torch.tensor(batch,device=device)
            scores=energy(q[:,None,:].expand(-1,nd,-1),emb[None,:nd,:].expand(len(batch),-1,-1))
            correct=scores.gather(1,labels[:,None])
            ranks.append(1+(scores<correct).sum(1)+(scores==correct).sum(1).sub(1)*.5)
            losses.append(torch.nn.functional.softplus(1+correct-scores).mean(1))
            if baseline:
                overlap=torch.sparse.mm(reference,obs.to_dense().T).T
                truth=overlap.gather(1,labels[:,None])
                branks.append(1+(overlap>truth).sum(1)+(overlap==truth).sum(1).sub(1)*.5)
        result=metrics(ranks)
        result['loss']=torch.cat(losses).mean().item()
        if baseline: result['overlap_baseline']=metrics(branks)
        return result

    best=float('inf'); best_epoch=0; history=[]; stale=0; started=time.perf_counter()
    def save(name,epoch):
        torch.save(dict(state_dict=model.state_dict(),optimizer=optimizer.state_dict(),scheduler=scheduler.state_dict(),
            hidden=original['hidden'],num_nodes=graph['num_nodes'],epochs=original['epochs']+epoch,additional_epochs=epoch,
            data_sha256=manifest['processed_sha256'],seed=args.seed,device=str(device)),OUT/name)
    for epoch in range(1,args.epochs+1):
        tick=time.perf_counter(); model.train(); optimizer.zero_grad(set_to_none=True)
        emb=model.hgnn(incidence,graph['num_hyperedges'])
        order=torch.randperm(len(train_ids),device=device)
        # Metadata sampling on CPU; sparse pooling, contrasts, loss and gradients on CUDA.
        shuffled=[splits['train'][i] for i in order.tolist()]
        total=0.; valid_total=0
        for start in range(0,len(shuffled),args.batch_size):
            batch=shuffled[start:start+args.batch_size]
            obs=queries(batch,.5,args.seed+epoch*100000+start)
            q=torch.sparse.mm(obs,emb[nd:])
            labels=torch.tensor(batch,device=device)
            negatives=train_ids[torch.randint(len(train_ids),(len(batch),32),device=device)]
            # Filter every known positive superset, using GPU sparse overlap.
            overlap=torch.sparse.mm(reference,obs.to_dense().T).T
            valid=(overlap.gather(1,negatives)<1-1e-6)&(negatives!=labels[:,None])
            positive=energy(q,emb[labels])[:,None]
            contrast=energy(q[:,None,:].expand(-1,32,-1),emb[negatives])
            raw=torch.nn.functional.softplus(1+positive-contrast)
            loss=(raw*valid).sum()/valid.sum().clamp_min(1)
            assert torch.isfinite(loss)
            (loss*len(batch)/len(shuffled)).backward(retain_graph=start+args.batch_size<len(shuffled))
            total+=loss.item()*len(batch); valid_total+=valid.sum().item()
        assert valid_total>0
        assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters())
        torch.nn.utils.clip_grad_norm_(model.parameters(),5,error_if_nonfinite=True)
        optimizer.step(); del emb,q,loss,raw,positive,contrast
        val=evaluate(splits['validation'])
        scheduler.step(val['loss'])
        if val['loss']<best-1e-5:
            best=val['loss']; best_epoch=epoch; stale=0
            save('best_model.pt',epoch); dump('validation_metrics.json',val|dict(epoch=epoch))
        else: stale+=1
        save('last_model.pt',epoch)
        torch.cuda.synchronize()
        rec=dict(epoch=epoch,training_loss=total/len(shuffled),validation_loss=val['loss'],validation_mrr=val['mrr'],validation_top1=val['top_1_accuracy'],
            learning_rate=optimizer.param_groups[0]['lr'],epoch_seconds=time.perf_counter()-tick,
            gpu_allocated_bytes=torch.cuda.memory_allocated(),gpu_peak_bytes=torch.cuda.max_memory_allocated(),total_seconds=time.perf_counter()-started)
        history.append(rec)
        with (OUT/'training_history.csv').open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(rec)); writer.writeheader(); writer.writerows(history)
        print(json.dumps(rec),flush=True)
        if stale>=args.patience: break
    duration=time.perf_counter()-started
    checkpoint=torch.load(OUT/'best_model.pt',weights_only=True,map_location=device)
    assert checkpoint['data_sha256']==manifest['processed_sha256']
    model.load_state_dict(checkpoint['state_dict'])
    test={str(fraction):evaluate(splits['test'],fraction,True) for fraction in (1.,.5,.25)}
    dump('test_metrics.json',test)
    with torch.no_grad():
        emb=model.hgnn(incidence,graph['num_hyperedges'])
        d=splits['test'][0]; observed=sorted(profiles[d])[:max(1,len(profiles[d])//2)]
        q=emb[torch.tensor(observed,device=device)+nd].mean(0).expand(nd,-1)
        ranked=energy(q,emb[:nd]).topk(10,largest=False).indices.tolist()
    dump('inference_example.json',dict(actual_disease=graph['disease_ids'][d],observed_phenotypes=[graph['phenotype_ids'][i] for i in observed],rankings=[graph['disease_ids'][i] for i in ranked]))
    dump('verification.json',dict(cuda_parameters=True,cuda_forward_backward=True,finite_gradients=True,best_checkpoint_reload=True,train_test_disjoint=True,real_phenotype_ranking=True,cpu_fallback=False))
    primary=test['0.5']
    lines=['# Final CUDA training report','', '| Metric | Result |','|---|---|']
    values={'GPU':config['gpu'],'CUDA runtime':config['cuda'],'Additional training epochs':epoch,'Original epochs':original['epochs'],'Best additional epoch':best_epoch,'Best validation loss':best,
        'Top-1':primary['top_1_accuracy'],'Top-3':primary['top_3_accuracy'],'Top-5':primary['top_5_accuracy'],'MRR':primary['mrr'],
        'Peak GPU bytes':torch.cuda.max_memory_allocated(),'Training seconds (includes validation/checkpoints)':duration,'Best checkpoint':str(OUT/'best_model.pt')}
    lines += [f'| {k} | {v} |' for k,v in values.items()]
    lines += ['',f"Beats overlap baseline MRR: {primary['mrr']>primary['overlap_baseline']['mrr']}. Baseline MRR: {primary['overlap_baseline']['mrr']}.",
        '',config['evaluation'],config['baseline'],
        'Held-out disease identity embeddings have no positive training updates. The original architecture has no inductive disease encoder. Cold-start performance is a limitation, not evidence of clinical efficacy.',
        'Original five-epoch checkpoint preserved at models/hgnn_ebm.pt. Resume uses its weights with a fresh AdamW optimizer because the original checkpoint has no optimizer state.',
        'Full graph is never used by the HGNN. Test data is evaluated only after validation selection. Mixed precision applies to dense energy layers; sparse propagation remains FP32.',
        'CPU operations: file I/O, provenance validation, metadata/query sampling, logging and checkpoint serialization. CUDA: model, sparse graph propagation, pooling, negative sampling/filtering, loss, backward, AdamW and ranking.']
    (OUT/'final_training_report.md').write_text('\n'.join(lines),encoding='utf-8')
    print(json.dumps(values),flush=True)

if __name__=='__main__': main()
