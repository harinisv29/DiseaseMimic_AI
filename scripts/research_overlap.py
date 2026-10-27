"""Real-data baseline, explicitly distinct from a learned model prediction."""
import argparse
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.knowledge_base import KnowledgeBase

parser=argparse.ArgumentParser()
parser.add_argument('phenotypes',nargs='+',help='Present observations, as HPO IDs')
args=parser.parse_args()
kb=KnowledgeBase()
results=kb.overlap([dict(phenotype_id=hp,state='present') for hp in args.phenotypes])
print(json.dumps({'mode':'real-data overlap baseline','results':results,'notice':'Overlap is not disease probability or a trained compatibility score.'},indent=2))
