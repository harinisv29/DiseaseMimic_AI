"""Launch the unchanged CUDA ranker with read-only dashboard adapters."""
from runtime import require_cuda
import uvicorn
if __name__=='__main__':
    require_cuda()
    uvicorn.run('dashboard_api:app',host='127.0.0.1',port=8000,access_log=False)
