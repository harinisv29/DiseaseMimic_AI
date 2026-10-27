# Pipeline audit and CUDA run

Architecture: `models/hgnn_ebm.py` contains a 48-dimensional embedding table, two sparse degree-normalized HGNN layers with residual linear transforms and dropout, and a three-input compatibility MLP (profile, disease, elementwise product). Architecture retained.

Before this change, `scripts/train_models.py` selected CPU automatically when CUDA was unavailable and accepted `--device cpu`. Its tensors followed that selection. `scripts/verify_model.py` and the gradient integration test always executed on CPU. `run.py` and `scripts/runtime.py` allowed a CPU-package override. There were no ranking evaluation or validation-selected training implementations.

Now `scripts/train_models.py` calls `scripts/final_gpu_training.py`. All model execution requires CUDA, including HGNN and energy scoring. `scripts/runtime.py` resolves the local CUDA package installation and fails closed without CUDA. The launcher no longer accepts the CPU-only environment override. The model rejects CPU execution itself. Preprocessing retains CPU tensors and is not rerun.

Data loading: `scripts/preprocess_datasets.py:read_csv`. Construction in that module builds one hyperedge per disease, excluding absent/conflicting memberships and isolating training diseases in `train_incidence_index`. `scripts/validate_datasets.py` verifies raw and processed hashes, identity-group separation, and exact incidence reconstruction before optimization. No raw or processed datasets are modified by training.

Training resumes weights from `models/hgnn_ebm.pt` with a fresh optimizer (original checkpoint has no optimizer state). Original checkpoint remains untouched. New best/last checkpoints include optimizer and scheduler states and dataset hashes. Full-graph message passing runs once per optimization epoch; query batches of 256 accumulate gradients, followed by one clipped AdamW update. Sparse matrix operations stay FP32; compatible energy layers use BF16. Model, embeddings, incidence, pooling, negative sampling/filtering, losses, backward, optimizer updates and evaluation ranking execute on CUDA. Metadata sampling, file loading, validation, serialization and logging use CPU.

Evaluation uses existing disease-disjoint validation and test splits, never full-graph HGNN propagation. Validation loss selects checkpoints. Ranking considers every disease. Equal scores receive average ranks, including for the overlap baseline. Recall@K equals Top-K accuracy because each source-derived query has one designated disease. The annotation-overlap baseline has complete disease reference profiles; the learned HGNN receives training graph only. These distinct information assumptions are explicit. Test evaluation includes 100%, 50%, and 25% retained phenotypes. The original identity-based model has no inductive disease encoder, so cold-start ranking may be poor.

Run from project root in PowerShell:

```powershell
& .\.runtime\python\python.exe run.py scripts/train_models.py --epochs 150 --batch-size 256 --patience 15
& .\.runtime\python\python.exe run.py scripts/verify_model.py
& .\.runtime\python\python.exe run.py scripts/run_tests.py
```

Artifacts: `runs/final-gpu-training/`. Consult `final_training_report.md` only after the run succeeds. `inference_example.json` contains scores-derived rankings for actual HPO inputs. No frontend integration or clinical validation is implied.
