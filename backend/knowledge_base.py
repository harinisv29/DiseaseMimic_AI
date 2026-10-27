"""Research data access: real processed records only, never demo fallback."""
import csv
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class KnowledgeBase:
    def __init__(self, root=ROOT):
        self.root=Path(root)
        manifest_path=self.root/'data/metadata/dataset_manifest.json'
        validation_path=self.root/'data/metadata/validation_report.json'
        if not manifest_path.exists() or not validation_path.exists():
            raise RuntimeError('Run dataset download, preprocessing and validation before research use')
        self.manifest=json.loads(manifest_path.read_text())
        validation=json.loads(validation_path.read_text())
        if validation['status']!='passed' or validation.get('processed_sha256')!=self.manifest.get('processed_sha256'):
            raise RuntimeError('Dataset validation did not pass')
        def read(name):
            path=self.root/'data/processed'/name
            if hashlib.sha256(path.read_bytes()).hexdigest()!=self.manifest['processed_sha256'][name]:
                raise RuntimeError(f'Processed data checksum mismatch: {name}')
            with path.open(encoding='utf-8',newline='') as stream:
                csv.field_size_limit(10*1024*1024)
                return list(csv.DictReader(stream))
        self.diseases={r['disease_id']:r for r in read('diseases.csv')}
        self.phenotypes={r['phenotype_id']:r for r in read('phenotypes.csv')}
        self.associations={}
        for r in read('disease_phenotype.csv'):
            self.associations.setdefault(r['disease_id'],{}).setdefault(r['phenotype_id'],{})[r['state']]=r

    def observations(self, observations):
        states={}
        for observation in observations:
            hp,state=observation['phenotype_id'],observation['state']
            if hp not in self.phenotypes:
                raise ValueError(f'Unsupported phenotype: {hp}')
            if state not in {'present','absent','unknown'}:
                raise ValueError(f'Invalid observation state: {state}')
            if hp in states and states[hp]!=state:
                raise ValueError(f'Conflicting input observations: {hp}')
            states[hp]=state
        return {s:{hp for hp,state in states.items() if state==s} for s in ['present','absent','unknown']}

    def overlap(self, observations, limit=10):
        states=self.observations(observations)
        if not states['present']:
            return []
        result=[]
        for did,profile in self.associations.items():
            positive={p for p,s in profile.items() if 'present' in s and 'absent' not in s}
            excluded={p for p,s in profile.items() if 'absent' in s and 'present' not in s}
            matched=states['present'] & positive
            if not matched:
                continue
            conflicts=(states['present'] & excluded) | (states['absent'] & positive)
            result.append(dict(disease_id=did,name=self.diseases[did]['name'],matching_phenotypes=sorted(matched),
                               conflicting_phenotypes=sorted(conflicts),overlap_fraction=len(matched)/len(states['present']),
                               # This is source coverage, not a probability or trained score.
                               evidence=[profile[p] for p in sorted(matched|conflicts)],
                               knowledge_state='unlisted phenotypes unknown'))
        return sorted(result,key=lambda r:(-len(r['matching_phenotypes']),len(r['conflicting_phenotypes']),r['disease_id']))[:limit]
