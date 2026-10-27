"""Launch the research API on localhost with mandatory CUDA."""
from runtime import require_cuda
import uvicorn

if __name__ == "__main__":
    require_cuda()
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000)
