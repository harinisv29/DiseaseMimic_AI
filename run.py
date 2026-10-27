"""Isolated embedded-runtime launcher; regular Python can run scripts directly."""
import runpy
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / '.packages'), str(ROOT)]
if (ROOT/'.cuda-packages/torch').is_dir():
    sys.path.insert(0,str(ROOT/'.cuda-packages'))
if len(sys.argv) < 2:
    raise SystemExit('Usage: python run.py scripts/download_datasets.py [arguments]')
target = sys.argv.pop(1)
sys.path.insert(0,str((ROOT/target).parent))
runpy.run_path(str(ROOT / target), run_name='__main__')
