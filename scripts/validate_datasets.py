"""Fail closed on altered downloads, unresolved references, or split leakage."""
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

from preprocess_datasets import ROOT, OUT, META, read_csv
import torch

def validate():
    manifest=json.loads((META/'dataset_manifest.json').read_text())
    assert len(manifest['datasets'])==4
    for item in manifest['datasets']:
        path=Path(item['local_path'])
        assert item['status']=='downloaded', item
        assert path.stat().st_size==item['size_bytes'], str(path)
        assert hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256'], str(path)
    for name,digest in manifest['processed_sha256'].items():
        assert hashlib.sha256((OUT/name).read_bytes()).hexdigest()==digest, name
    diseases=read_csv('diseases.csv')
    phenotypes=read_csv('phenotypes.csv')
    associations=read_csv('disease_phenotype.csv')
    assert diseases and phenotypes and associations
    did={d['disease_id']:d for d in diseases}
    pid={p['phenotype_id'] for p in phenotypes}
    keys=set()
    groups=defaultdict(set)
    for d in diseases:
        groups[d['identity_group']].add(d['split'])
    assert all(len(v)==1 for v in groups.values()), 'Identity group split leakage'
    negative=set()
    for a in associations:
        key=(a['disease_id'],a['phenotype_id'],a['state'])
        assert key not in keys, 'Duplicate normalized association'
        keys.add(key)
        assert a['disease_id'] in did and a['phenotype_id'] in pid
        assert a['state'] in {'present','absent','unknown'}
        assert a['split']==did[a['disease_id']]['split']
        evidence=json.loads(a['evidence'])
        assert evidence and all(e['source'] in {'HPO','Orphadata'} and e['metadata'] for e in evidence)
        if a['state']=='absent':
            negative.add(key[:2])
    graph=torch.load(OUT/'hypergraph_data.pt',weights_only=True)
    di,pi=graph['disease_ids'],graph['phenotype_ids']
    dindex,pindex={x:i for i,x in enumerate(di)},{x:i for i,x in enumerate(pi)}
    for field,split in [('incidence_index',None),('train_incidence_index','train')]:
        actual=set(map(tuple,graph[field].T.tolist()))
        expected=set()
        for a in associations:
            if a['state']!='present' or (a['disease_id'],a['phenotype_id']) in negative or (split and a['split']!=split):
                continue
            d=dindex[a['disease_id']]
            p=len(di)+pindex[a['phenotype_id']]
            expected.update([(d,d),(p,d)])
        assert actual==expected, f'{field}: graph differs from processed source records'
    report={'status':'passed','processed_sha256':manifest['processed_sha256'],'checks':['raw sizes and SHA256','processed SHA256','valid foreign keys','states and provenance','deduplication','identity-group split isolation','exact full and training incidence reconstruction'],
            'diseases':len(diseases),'phenotypes':len(phenotypes),'associations':len(associations)}
    (META/'validation_report.json').write_text(json.dumps(report,indent=2))
    lines=['# Measured dataset verification','',f"Validation: **{report['status']}**",'',f"Combined: {len(diseases):,} diseases; {len(phenotypes):,} active ontology terms; {len(associations):,} state-specific associations.",'']
    for entry in manifest['datasets']:
        lines.extend([f"## {entry['name']}",'',f"- Official source: {entry['source_url']}",f"- Status: {entry['status']}",f"- Local path: `{entry['local_path']}`",f"- Bytes: {entry['size_bytes']}",f"- Measured records: {json.dumps(entry['record_counts'])}",f"- Downloaded (UTC): {entry['downloaded_at']}",f"- Source version: {json.dumps(entry.get('source_version'))}",f"- SHA256: `{entry['sha256']}`",f"- License/access: {entry['license']}; {entry['access']}",''])
    (META/'download_verification.md').write_text('\n'.join(lines),encoding='utf-8')
    print('\n'.join(lines))
    return report

if __name__=='__main__':
    validate()
