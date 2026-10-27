"""Normalize real source assertions with reversible provenance and cautious mapping."""
import csv
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.packages'))
import torch

RAW = ROOT / 'data/raw'
OUT = ROOT / 'data/processed'
META = ROOT / 'data/metadata'

def save_csv(name, rows, fields=None):
    rows = list(rows)
    with (OUT / name).open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields or list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

def read_csv(name):
    csv.field_size_limit(10 * 1024 * 1024)
    with (OUT / name).open(encoding='utf-8', newline='') as stream:
        return list(csv.DictReader(stream))

def parse_obo(path):
    terms, version, current = {}, '', None
    def commit():
        if current and current.get('id', [''])[0].startswith('HP:'):
            terms[current['id'][0]] = dict(current)
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('data-version: '):
            version = line.split(': ', 1)[1]
        if line.startswith('['):
            commit()
            current = defaultdict(list) if line == '[Term]' else None
        elif current is not None and ': ' in line:
            key, value = line.split(': ', 1)
            current[key].append(value)
    commit()
    return terms, version

def hpo_rows(path):
    metadata, lines = {}, []
    with path.open(encoding='utf-8-sig') as stream:
        for line in stream:
            if line.startswith('#'):
                text = line.lstrip('#').strip()
                if text.startswith(('database_id\t', 'DatabaseID\t')):
                    lines.append(text+'\n')
                elif ':' in text:
                    key, value = text.split(':', 1)
                    metadata[key.strip()] = value.strip()
            else:
                lines.append(line)
    for row in csv.DictReader(lines, delimiter='\t'):
        yield row, metadata

def xml_disorders(path):
    for _, node in ET.iterparse(path, events=('end',)):
        if node.tag == 'Disorder':
            yield node
            node.clear()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (META/'validation_report.json').write_text(json.dumps({'status':'pending','reason':'Preprocessing requires fresh validation'}))
    manifest = json.loads((META / 'dataset_manifest.json').read_text())
    if len(manifest['datasets']) != 4 or any(x['status'] != 'downloaded' for x in manifest['datasets']):
        raise RuntimeError('All four official downloads must succeed before integration')
    terms, version = parse_obo(RAW / 'hpo/hp.obo')
    active = {k: t for k,t in terms.items() if t.get('is_obsolete') != ['true']}
    aliases = {alt: k for k,t in active.items() for alt in t.get('alt_id', [])}
    for k,t in terms.items():
        replacements = t.get('replaced_by', [])
        if k not in active and len(replacements) == 1 and replacements[0] in active:
            aliases[k] = replacements[0]
    phenotypes = [dict(phenotype_id=k, name=t.get('name',[''])[0],normalized_name=' '.join(t.get('name',[''])[0].casefold().split()), synonyms=json.dumps(t.get('synonym',[])),
                       synonym_labels=json.dumps([re.match(r'"((?:[^"\\]|\\.)*)"',s).group(1) for s in t.get('synonym',[]) if re.match(r'"((?:[^"\\]|\\.)*)"',s)]),
                       parent_ids=json.dumps([p.split()[0] for p in t.get('is_a',[])]),
                       alt_ids=json.dumps(t.get('alt_id',[])), parents=json.dumps(t.get('is_a',[])),
                       relationships=json.dumps(t.get('relationship',[])), definition=json.dumps(t.get('def',[]))) for k,t in sorted(active.items())]
    save_csv('phenotypes.csv', phenotypes)
    save_csv('ontology_terms.csv', [dict(phenotype_id=k, metadata=json.dumps(t)) for k,t in sorted(terms.items())])
    # Only exact one-to-one OMIM mappings are merged. Broad/narrow or many-to-many
    # external references remain cross references, never assumed equivalences.
    references, exact = [], defaultdict(set)
    orpha_names = {}
    for node in xml_disorders(RAW / 'orphadata/en_product1.xml'):
        oid = 'ORPHA:' + node.findtext('OrphaCode', '')
        orpha_names[oid] = node.findtext('Name', '')
        for ref in node.findall('./ExternalReferenceList/ExternalReference'):
            source, value = ref.findtext('Source',''), ref.findtext('Reference','')
            relation = ref.findtext('./DisorderMappingRelation/Name', '')
            references.append(dict(orpha_id=oid, external_id=f'{source}:{value}', relation=relation, metadata=ET.tostring(ref, encoding='unicode')))
            if source == 'OMIM' and relation.startswith('E ('):
                exact[f'OMIM:{value}'].add(oid)
    reverse = defaultdict(set)
    for external, ids in exact.items():
        for oid in ids:
            reverse[oid].add(external)
    mapping = {external: next(iter(ids)) for external,ids in exact.items() if len(ids)==1 and len(reverse[next(iter(ids))])==1}
    save_csv('disease_cross_references.csv', references)
    diseases, assertions, rejected, source_stats = {}, [], [], {}
    hpo_original, orpha_ids, mapped_hpo = set(), set(), set()
    def add(source, original_disease, name, hp, state, frequency, metadata):
        normalized = aliases.get(hp,hp)
        disease = mapping.get(original_disease,original_disease)
        diseases.setdefault(disease, dict(disease_id=disease, name=orpha_names.get(disease,name), original_ids=set(), sources=set()))
        diseases[disease]['original_ids'].add(original_disease)
        diseases[disease]['sources'].add(source)
        if normalized not in active:
            rejected.append(dict(source=source, disease_id=original_disease, phenotype_id=hp, reason='Unresolved or obsolete HPO ID', metadata=json.dumps(metadata)))
            return
        frequency_term=active.get(frequency,{})
        label=frequency_term.get('name',[frequency])[0]
        if label.lower()=='excluded':
            state='absent'
        if '%' not in label and frequency_term:
            label=' '.join(frequency_term.get('def',[]))
        numbers=re.findall(r'\d+(?:\.\d+)?',label)
        lower=upper=None
        if state=='absent':
            lower=upper=0.0
        elif re.fullmatch(r'\d+/\d+',frequency):
            numerator,denominator=map(int,frequency.split('/'))
            if denominator and 0<=numerator<=denominator:
                lower=upper=numerator/denominator
        elif '%' in label and numbers:
            values=[float(n)/100 for n in numbers]
            lower,upper=min(values),max(values)
        assertions.append(dict(disease_id=disease, phenotype_id=normalized, state=state, source=source,
                               original_disease_id=original_disease, original_phenotype_id=hp,
                               frequency=frequency,frequency_lower=lower,frequency_upper=upper, metadata=json.dumps(metadata, sort_keys=True)))
    annotation_meta = {}
    for row, annotation_meta in hpo_rows(RAW / 'hpo/phenotype.hpoa'):
        row = {k.lower():v for k,v in row.items()}
        did, hp = row.get('database_id',''), row.get('hpo_id','')
        if not did or not hp:
            raise ValueError(f'Invalid HPO annotation: {row}')
        hpo_original.add(did)
        add('HPO', did, row.get('disease_name',''), hp, 'absent' if 'NOT' in row.get('qualifier','').split(';') else 'present', row.get('frequency',''), row)
    orpha_root = ET.parse(RAW / 'orphadata/en_product4.xml').getroot()
    xml_version = dict(orpha_root.attrib)
    for node in orpha_root.findall('.//Disorder'):
        did = 'ORPHA:' + node.findtext('OrphaCode','')
        orpha_ids.add(did)
        for association in node.findall('./HPODisorderAssociationList/HPODisorderAssociation'):
            hp = association.findtext('./HPO/HPOId','')
            freq = association.findtext('./HPOFrequency/Name','')
            # Excluded is explicit negative evidence; unspecified frequency does not
            # negate an association. Missing patient observations remain unknown.
            state = 'absent' if 'excluded' in freq.lower() else 'present'
            add('Orphadata', did, node.findtext('Name',''), hp, state, freq,
                {'xml':ET.tostring(association,encoding='unicode'), 'frequency_id':association.find('HPOFrequency').get('id','') if association.find('HPOFrequency') is not None else ''})
    del orpha_root
    grouped = defaultdict(list)
    unique_assertions = {json.dumps(a,sort_keys=True):a for a in assertions}
    assertions = list(unique_assertions.values())
    for a in assertions:
        grouped[(a['disease_id'],a['phenotype_id'],a['state'])].append(a)
    integrated = []
    for (did,hp,state), evidence in sorted(grouped.items()):
        integrated.append(dict(disease_id=did, phenotype_id=hp, state=state,
            sources=json.dumps(sorted({a['source'] for a in evidence})), frequencies=json.dumps(sorted({a['frequency'] for a in evidence})),
            evidence=json.dumps(evidence), split=''))
    # Split connected disease identity groups together, including ambiguous crosswalks.
    parent = {d:d for d in diseases}
    def find(x):
        while parent[x]!=x:
            parent[x]=parent[parent[x]]
            x=parent[x]
        return x
    for ref in references:
        a,b=mapping.get(ref['external_id'],ref['external_id']),ref['orpha_id']
        if a in parent and b in parent:
            ra,rb=find(a),find(b)
            if ra!=rb:
                parent[max(ra,rb)]=min(ra,rb)
    def split(d):
        bucket=int(hashlib.sha256(('DiseaseMimic-v1:'+find(d)).encode()).hexdigest()[:8],16)%100
        return 'train' if bucket<80 else 'validation' if bucket<90 else 'test'
    disease_rows=[]
    for did,d in sorted(diseases.items()):
        disease_rows.append(dict(disease_id=did,name=d['name'],original_ids=json.dumps(sorted(d['original_ids'])),sources=json.dumps(sorted(d['sources'])),identity_group=find(did),split=split(did)))
    for a in integrated:
        a['split']=split(a['disease_id'])
    save_csv('diseases.csv',disease_rows)
    save_csv('disease_phenotype.csv',integrated)
    save_csv('source_annotations.csv',assertions)
    save_csv('unmatched_phenotypes.csv',rejected, ['source','disease_id','phenotype_id','reason','metadata'])
    all_d=sorted(diseases)
    all_p=sorted(active)
    di,pi={d:i for i,d in enumerate(all_d)},{p:i for i,p in enumerate(all_p)}
    # One hyperedge per disease profile: disease node plus its positive phenotype
    # nodes. Conflicting positives/negatives are retained in CSV but excluded here.
    conflicts={(a['disease_id'],a['phenotype_id']) for a in integrated if a['state']=='absent'}
    def incidence(records):
        memberships={(di[a['disease_id']],di[a['disease_id']]) for a in records}
        memberships.update((len(di)+pi[a['phenotype_id']],di[a['disease_id']]) for a in records)
        return torch.tensor(sorted(memberships),dtype=torch.long).T.contiguous()
    positives=[a for a in integrated if a['state']=='present' and (a['disease_id'],a['phenotype_id']) not in conflicts]
    train=[a for a in positives if a['split']=='train']
    graph=dict(disease_ids=all_d,phenotype_ids=all_p,incidence_index=incidence(positives),train_incidence_index=incidence(train),
               disease_split={d:split(d) for d in all_d},num_nodes=len(di)+len(pi),num_hyperedges=len(di),
               semantics='disease profile hyperedge; training incidence excludes held-out diseases; absent/conflicting pairs excluded')
    torch.save(graph,OUT/'hypergraph_data.pt')
    matched={d for d in hpo_original if mapping.get(d,d) in orpha_ids}
    matched_orpha={mapping.get(d,d) for d in matched}
    unmatched=sorted(hpo_original-matched)
    for source in ['HPO','Orphadata']:
        aa=[a for a in assertions if a['source']==source]
        source_stats[source]=dict(diseases=len({a['original_disease_id'] for a in aa}),phenotypes=len({a['phenotype_id'] for a in aa}),associations=len(aa))
    summary=dict(ontology_version=version,hpo_annotation_metadata=annotation_meta,orphadata_version=xml_version,
        source_counts=source_stats,ontology_terms=len(terms),active_phenotypes=len(active),diseases=len(diseases),
        associations=len(integrated),source_assertions=len(assertions),rejected_phenotypes=len(rejected),
        positive_hypergraph_pairs=len(positives),train_hypergraph_pairs=len(train),
        excluded_associations=sum(a['state']=='absent' for a in integrated),conflicting_pairs=len({(a['disease_id'],a['phenotype_id']) for a in integrated if a['state']=='present'} & conflicts),
        mapping=dict(hpo_diseases=len(hpo_original),matched_to_orphadata=len(matched),coverage=len(matched)/len(hpo_original),
                     exact_omim_merges=len(mapping),unmatched_hpo_identifiers=unmatched,
                     orphadata_diseases=len(orpha_ids),orphadata_matched_to_hpo=len(matched_orpha),orphadata_coverage=len(matched_orpha)/len(orpha_ids),unmatched_orphadata_identifiers=sorted(orpha_ids-matched_orpha)),
        splits={s:sum(d['split']==s for d in disease_rows) for s in ['train','validation','test']},
        caveats=['HPO includes Orphanet-derived evidence; sources are not independent.',
                 'Missing association is unknown, never explicit absence.',
                 'Disease-disjoint grouped split; no held-out hyperedges in training.',
                 'No independent clinical patient validation; do not claim clinical accuracy.'])
    (META/'processing_report.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    for entry in manifest['datasets']:
        entry['source_version']=version if entry['name']=='HPO ontology' else annotation_meta if entry['name']=='HPO annotations' else xml_version if entry['name']=='Orphadata phenotypes' else dict(ET.parse(RAW/'orphadata/en_product1.xml').getroot().attrib)
        entry['record_counts']=dict(diseases=0,phenotypes=len(active),associations=0) if entry['name']=='HPO ontology' else source_stats['HPO'] if entry['name']=='HPO annotations' else source_stats['Orphadata'] if entry['name']=='Orphadata phenotypes' else dict(diseases=len(orpha_names),phenotypes=0,associations=len(references))
    manifest['processed_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file()}
    (META/'dataset_manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k not in ['mapping','hpo_annotation_metadata']},indent=2))
    print(f'Mapping coverage: {len(matched)}/{len(hpo_original)}; unmatched IDs saved in processing_report.json')

if __name__=='__main__':
    main()
