"""CUDA-only improved research ranking CLI."""
import argparse
import json
from runtime import ROOT
from backend.ranker import DiseaseRanker

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('phenotypes',nargs='+',help='Present HPO identifiers')
    ap.add_argument('--absent',nargs='*',default=[])
    ap.add_argument('--unknown',nargs='*',default=[])
    ap.add_argument('--available',nargs='*',default=None)
    ap.add_argument('--top-k',type=int,default=10)
    args=ap.parse_args()
    try:result=DiseaseRanker().rank(args.phenotypes,args.absent,args.unknown,args.available,args.top_k)
    except ValueError as exc:ap.error(str(exc))
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
