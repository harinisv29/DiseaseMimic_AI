"""Record real local inference and verify preservation, without changing model artifacts."""
import hashlib
import json
import urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'runs/patient-centered-upgrade'
OUT.mkdir(parents=True,exist_ok=True)
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def request(path,payload=None):
    data=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request('http://127.0.0.1:8000'+path,data=data,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=45) as response:return json.load(response)
manifest=json.loads((ROOT/'data/metadata/dataset_manifest.json').read_text())
expected={ROOT/path:value for path,value in json.loads((ROOT/'runs/architecture-improvement/preserved_checkpoints.json').read_text()).items()}
verification=json.loads((ROOT/'runs/architecture-improvement/checkpoint_verification.json').read_text())
expected[ROOT/verification['checkpoint']]=verification['checkpoint_sha256']
for entry in manifest['datasets']:
    if entry.get('sha256'):expected[Path(entry['local_path'])]=entry['sha256']
for name,value in manifest['processed_sha256'].items():expected[ROOT/'data/processed'/name]=value
checks=[]
for path,value in expected.items():
    actual=sha(path)
    checks.append(dict(path=str(path.relative_to(ROOT)),expected=value,actual=actual,unchanged=actual==value))
assert all(c['unchanged'] for c in checks),'Preservation check failed'
(OUT/'preservation.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
health=request('/health');assert 'cuda' in health['device']
results=[]
for scenario in json.loads((ROOT/'frontend/src/demo-cases.json').read_text(encoding='utf-8-sig')):
    payload={'present':[o['id'] for o in scenario['observations']],'absent':[],'unknown':[],'limit':20}
    response=request('/rank',payload)
    assert response['rankings'] and 'cuda' in response['device']
    ids=','.join(r['disease_id'] for r in response['rankings'][:3])
    evidence=request('/dashboard/evidence?ids='+ids)
    results.append(dict(synthetic=True,scenario=scenario['id'],title=scenario['title'],request=payload,response=response,leading_reference_profiles=evidence))
(OUT/'real_scenarios.json').write_text(json.dumps({'recordedAt':datetime.now(timezone.utc).isoformat(),'health':health,'scenarios':results},indent=2),encoding='utf-8')
print(json.dumps({'preserved_files':len(checks),'unchanged':True,'synthetic_scenarios':len(results),'device':health['device']},indent=2))
