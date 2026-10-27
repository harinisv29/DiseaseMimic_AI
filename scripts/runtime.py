"""Resolve project-local packages consistently for direct and launcher entrypoints."""
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def configure():
    paths=[str(ROOT/'.packages'),str(ROOT),str(ROOT/'scripts')]
    if (ROOT/'.cuda-packages/torch').is_dir():
        paths.insert(0,str(ROOT/'.cuda-packages'))
    for path in reversed(paths):
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0,path)
configure()

def require_cuda():
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA GPU is required for DiseaseMimic AI training.')
    torch.cuda.set_device(0)
    return torch.device('cuda:0')
