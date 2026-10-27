"""Run all dataset stages sequentially, stopping immediately on any failure."""
import runpy
import sys
from pathlib import Path

scripts=Path(__file__).resolve().parent
sys.path.insert(0,str(scripts))
for stage in ['download_datasets.py','preprocess_datasets.py','validate_datasets.py']:
    print(f'Running {stage}',flush=True)
    runpy.run_path(str(scripts/stage),run_name='__main__')
