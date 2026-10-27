"""Local research API for the validation-selected CUDA disease ranker."""
from contextlib import asynccontextmanager
from threading import Lock

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from backend.ranker import DiseaseRanker


@asynccontextmanager
async def lifespan(app):
    torch.set_num_threads(4)
    app.state.ranker = DiseaseRanker()
    app.state.lock = Lock()
    yield


app = FastAPI(
    title="DiseaseMimic AI Research API",
    description="CUDA disease ranking and next-observation suggestions. "
    "Exploratory research results; scores are not disease probabilities.",
    lifespan=lifespan,
)


class RankRequest(BaseModel):
    present: list[str] = Field(examples=[["HP:0000135", "HP:0001249"]])
    absent: list[str] = Field(default_factory=list)
    unknown: list[str] = Field(default_factory=list)
    available: list[str] | None = None
    limit: int = Field(default=10, ge=1, le=100)


@app.get("/health")
def health():
    ranker = app.state.ranker
    return {"status": "ready", "device": str(ranker.device),
            "method": ranker.decision["default_method"],
            "gpu": torch.cuda.get_device_name(0)}


@app.post("/rank")
def rank(request: RankRequest):
    try:
        with app.state.lock:
            return app.state.ranker.rank(
                request.present, request.absent, request.unknown,
                request.available, request.limit,
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
