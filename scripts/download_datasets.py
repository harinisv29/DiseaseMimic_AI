"""Download official upstream bytes; never substitute generated records."""
import hashlib
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, urlunsplit
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'data/metadata/dataset_manifest.json'
SOURCES = [
    ('HPO ontology', 'hpo/hp.obo', 'https://purl.obolibrary.org/obo/hp.obo', 'HPO terms: acknowledge/cite Consortium, display source date/version, preserve original files and ontology relationships; https://hpo.jax.org/license'),
    ('HPO annotations', 'hpo/phenotype.hpoa', 'https://purl.obolibrary.org/obo/hp/hpoa/phenotype.hpoa', 'HPO terms: acknowledge/cite Consortium, display source date/version, preserve original files and ontology relationships; https://hpo.jax.org/license'),
    ('Orphadata phenotypes', 'orphadata/en_product4.xml', 'https://www.orphadata.com/data/xml/en_product4.xml', 'CC BY 4.0; attribution and indicate modifications'),
    ('Orphadata alignments', 'orphadata/en_product1.xml', 'https://www.orphadata.com/data/xml/en_product1.xml', 'CC BY 4.0; attribution and indicate modifications'),
]

def checksum(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    entries = []
    for name, relative, url, license_text in SOURCES:
        path = ROOT / 'data/raw' / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        old = next((r for r in previous.get('datasets', []) if r['source_url'] == url), {})
        entry = dict(name=name, source_url=url, local_path=str(path.resolve()), license=license_text,
                     access='Public download; no authentication', status='pending')
        if path.exists() and old.get('sha256') == checksum(path) and old.get('status') == 'downloaded':
            entry = old
            entry['license']=license_text
            if entry.get('resolved_url'):
                resolved=urlsplit(entry['resolved_url'])
                entry['resolved_url']=urlunsplit((resolved.scheme,resolved.netloc,resolved.path,'',''))
            print(f'Verified cached {name}: {path}', flush=True)
        else:
            for attempt in range(3):
                try:
                    request = urllib.request.Request(url, headers={'User-Agent': 'DiseaseMimic-AI-research/1.0'})
                    with urllib.request.urlopen(request, timeout=120) as response, path.with_suffix(path.suffix+'.part').open('wb') as output:
                        shutil.copyfileobj(response, output)
                        resolved=urlsplit(response.url)
                        entry.update(resolved_url=urlunsplit((resolved.scheme,resolved.netloc,resolved.path,'','')), last_modified=response.headers.get('Last-Modified'), etag=response.headers.get('ETag'))
                    temporary = path.with_suffix(path.suffix+'.part')
                    if temporary.stat().st_size < 1000:
                        raise ValueError('Unexpectedly small dataset')
                    temporary.replace(path)
                    entry.update(status='downloaded', downloaded_at=datetime.now(timezone.utc).isoformat(), size_bytes=path.stat().st_size, sha256=checksum(path))
                    print(f'Downloaded {name}: {path.stat().st_size:,} bytes -> {path}', flush=True)
                    break
                except Exception as exc:
                    entry.update(status='failed', error=f'{type(exc).__name__}: {exc}')
                    print(f'{name}: {entry["error"]}', file=sys.stderr, flush=True)
                    transient = isinstance(exc, (TimeoutError, ConnectionError)) or (isinstance(exc, urllib.error.URLError) and isinstance(exc.reason,TimeoutError)) or (isinstance(exc, urllib.error.HTTPError) and exc.code in (429,500,502,503,504))
                    if not transient or attempt == 2:
                        break
                    time.sleep(2 ** attempt)
        entries.append(entry)
        MANIFEST.write_text(json.dumps({'datasets': entries}, indent=2), encoding='utf-8')
    if any(e['status'] != 'downloaded' for e in entries):
        raise SystemExit('Official download failed; inspect dataset_manifest.json. No substitute data created.')

if __name__ == '__main__':
    main()
