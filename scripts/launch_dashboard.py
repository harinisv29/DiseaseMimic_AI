"""Start or reuse the local dashboard and its CUDA research API."""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from runtime import ROOT


def read_url(url):
    try:
        with urllib.request.urlopen(url,timeout=2) as response:return response.read()
    except (OSError,urllib.error.URLError):return None


def start(command,cwd,name):
    output=(ROOT/'runs'/f'{name}.stdout.log').open('a',encoding='utf-8')
    errors=(ROOT/'runs'/f'{name}.stderr.log').open('a',encoding='utf-8')
    env=os.environ.copy()
    process=subprocess.Popen(command,cwd=cwd,stdout=output,stderr=errors,env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    (ROOT/'runs'/f'{name}.pid').write_text(str(process.pid))
    return process


def wait_for(url,process):
    for _ in range(100):
        if read_url(url):return
        if process.poll() is not None:raise RuntimeError('Server exited. Inspect its runs/*.stderr.log file.')
        time.sleep(.5)
    raise RuntimeError('Server startup timed out. Inspect runs/*.stderr.log.')


def main():
    if read_url('http://127.0.0.1:8000/health'):
        if not read_url('http://127.0.0.1:8000/dashboard/metadata'):
            raise RuntimeError('Port 8000 is occupied by an API without dashboard adapters. Stop that process and launch scripts/serve_dashboard.py.')
    else:
        api=start([str(ROOT/'.runtime/python/python.exe'),'-u',str(ROOT/'run.py'),'scripts/serve_dashboard.py'],ROOT,'dashboard-api')
        wait_for('http://127.0.0.1:8000/dashboard/metadata',api)
    existing=read_url('http://127.0.0.1:5173')
    if existing and b'DiseaseMimic' not in existing:raise RuntimeError('Port 5173 is used by another application.')
    if not existing:
        node=next((ROOT/'.runtime/node').glob('*/node.exe'),None)
        if node is None:raise RuntimeError('Project-local Node.js runtime is missing.')
        web=start([str(node),'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],ROOT/'frontend','dashboard-web')
        wait_for('http://127.0.0.1:5173',web)
    print('Dashboard: http://127.0.0.1:5173')
    print('API documentation: http://127.0.0.1:8000/docs')

if __name__=='__main__':main()
