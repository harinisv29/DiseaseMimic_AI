# Final CUDA training report

| Metric | Result |
|---|---|
| GPU | NVIDIA GeForce RTX 4070 SUPER |
| CUDA runtime | 13.0 |
| Additional training epochs | 46 |
| Original epochs | 5 |
| Best additional epoch | 31 |
| Best validation loss | 1.3045955896377563 |
| Top-1 | 0.002044989727437496 |
| Top-3 | 0.002044989727437496 |
| Top-5 | 0.002044989727437496 |
| MRR | 0.003584796329960227 |
| Peak GPU bytes | 409713664 |
| Training seconds (includes validation/checkpoints) | 25.699311799995485 |
| Best checkpoint | C:\Users\Admin\.vscode\DiseaseMimic-AI\runs\final-gpu-training\best_model.pt |

Beats overlap baseline MRR: False. Baseline MRR: 0.8171011209487915.

Disease-disjoint cold start; all diseases are ranking candidates. Source profiles, not patient cases.
Count shared observed phenotypes against complete reference catalog; held-out profiles available to baseline only. Ties use average rank.
Held-out disease identity embeddings have no positive training updates. The original architecture has no inductive disease encoder. Cold-start performance is a limitation, not evidence of clinical efficacy.
Original five-epoch checkpoint preserved at models/hgnn_ebm.pt. Resume uses its weights with a fresh AdamW optimizer because the original checkpoint has no optimizer state.
Full graph is never used by the HGNN. Test data is evaluated only after validation selection. Mixed precision applies to dense energy layers; sparse propagation remains FP32.
CPU operations: file I/O, provenance validation, metadata/query sampling, logging and checkpoint serialization. CUDA: model, sparse graph propagation, pooling, negative sampling/filtering, loss, backward, AdamW and ranking.
Verification completed: all 9 integration tests passed, including CUDA gradient execution, finite CUDA parameters, best-checkpoint inference, split isolation, and rejection of CPU execution/unavailable CUDA. Checkpoint reload separately passed with 1,479,265 parameters. See `checkpoint_verification.json`, `verification.json`, and `data/metadata/test_report.json`.

At 50% retained phenotypes, 978 held-out queries produced mean rank 3977.8262, Recall@1/3/5 0.00204499, and Recall@10 0.00408998. With all phenotypes retained, model MRR was 0.0030260 and Top-1 accuracy 0.10225%; overlap MRR was 0.9372333 and Top-1 accuracy 90.0818%. Full metrics for 100%, 50%, and 25% retention are in `test_metrics.json`.

The run stopped after 46 additional epochs (51 including the original five); the best checkpoint contains 36 cumulative epochs (31 additional). Peak PyTorch allocation during training was 371.12 MiB; peak including final evaluation was 390.73 MiB. NVIDIA telemetry observed the Python CUDA process and 46% GPU utilization during execution (`nvidia-smi.txt`). Device-wide VRAM usage also includes the display and other applications.

The training and verification work is complete. The model is available for research integration, but its measured cold-start accuracy does not support replacing the overlap baseline. Addressing this limitation requires a separately evaluated architecture that can represent unseen diseases from reference profiles.
