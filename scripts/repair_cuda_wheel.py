"""Repair missing wheel entries using official HTTPS ZIP ranges and ZIP CRC checks."""
import io, struct, urllib.request, zipfile
from pathlib import Path
url='https://download.pytorch.org/whl/cu130/torch-2.11.0%2Bcu130-cp312-cp312-win_amd64.whl'
size=1915224818
root=Path(__file__).resolve().parents[1]
def fetch(start,end):
    req=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
    with urllib.request.urlopen(req,timeout=60) as r:
        if r.status!=206: raise RuntimeError('Server did not honor range')
        return r.read()
tail=fetch(size-65536,size-1)
pos=tail.rfind(b'PK\x05\x06')
eocd=struct.unpack_from('<4s4H2LH',tail,pos)
cd_size,cd_offset=eocd[5:7]
print('Central directory:',cd_offset,cd_size,flush=True)
central=fetch(cd_offset,size-1)
class SparseZip(io.RawIOBase):
    def __init__(self): self.pos=0
    def seek(self,offset,whence=0):
        self.pos=offset if whence==0 else self.pos+offset if whence==1 else size+offset
        return self.pos
    def tell(self): return self.pos
    def read(self,n=-1):
        n=size-self.pos if n<0 else n
        if self.pos<cd_offset: raise RuntimeError('Central directory access only')
        out=central[self.pos-cd_offset:self.pos-cd_offset+n];self.pos+=len(out);return out
z=zipfile.ZipFile(SparseZip())
missing=[i for i in z.infolist() if not i.is_dir() and not (root/'.cuda-packages'/i.filename).exists()]

ranges=[]
for item in sorted(missing,key=lambda x:x.header_offset):
    a=item.header_offset; b=min(size-1,a+30+len(item.filename.encode())+item.compress_size+65536)
    if ranges and a<=ranges[-1][1]+1048576:
        ranges[-1][1]=max(ranges[-1][1],b)
    else: ranges.append([a,b])
print('Missing entries:',len(missing),'range bytes:',sum(b-a+1 for a,b in ranges),'requests:',len(ranges),flush=True)
chunks=[(cd_offset,central)]
for a,b in ranges:
    print('Fetching',a,b,flush=True)
    chunks.append((a,fetch(a,b)))
class RangedZip(SparseZip):
    def read(self,n=-1):
        n=size-self.pos if n<0 else n
        for a,data in chunks:
            if a<=self.pos and self.pos+n<=a+len(data):
                out=data[self.pos-a:self.pos-a+n];self.pos+=len(out);return out
        raise RuntimeError(('Uncached read',self.pos,n))
with zipfile.ZipFile(RangedZip()) as source:
    for item in missing:
        target=(root/'.cuda-packages'/item.filename).resolve()
        if not target.is_relative_to((root/'.cuda-packages').resolve()): raise RuntimeError('Invalid archive path')
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(source.read(item.filename))
print('Missing CUDA wheel entries restored with ZIP CRC verification.',flush=True)
