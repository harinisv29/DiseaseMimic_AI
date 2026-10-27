# Improved disease-profile research workflow

Use the existing embedded runtime and CUDA PyTorch installation. No datasets are downloaded or rebuilt by this workflow.

```powershell
& .\.runtime\python\python.exe run.py scripts/improve_architecture.py --epochs 150 --batch-size 256 --seeds 42 43 44
& .\.runtime\python\python.exe run.py scripts/run_tests.py
& .\.runtime\python\python.exe run.py scripts/predict_improved.py HP:0000135 HP:0001249 --unknown HP:0001250 --available HP:0001250 HP:0000252 --top-k 10
```

Training uses AdamW, finite-gradient assertions, clipping, validation-MRR scheduling, 15-epoch patience and CUDA-only execution. Sparse propagation stays FP32; dense compatibility MLPs use BF16 when supported. Three seeds have independent learned weights. Disease IDs select reference rows but have no trainable disease-specific parameters. Model selection and hybrid tuning use validation data only.

Read `runs/architecture-improvement/diagnostic_report.md` and `evaluation_protocol.md` for the root cause and information boundaries. Setting A permits the same complete disease reference catalog for every method, while all learned optimization and HGNN propagation use training diseases only. Setting B withholds unseen candidate reference profiles from every method. All reported experiments are exploratory because old test results motivated redesign. Queries are simulated masks, not new patient cases.

The six-method test table, confidence intervals, robustness conditions and next-observation results are in `final_research_report.md`, `test_metrics.json`, `baseline_comparison.csv`, and `observation_recommendation_metrics.json`. The first new-model attempt is preserved in `attempt-exact-ties/`; a final rerun corrects FP32 numerical tie handling. Existing original and GPU checkpoints are verified by SHA256.

For integration, import `backend.ranker.DiseaseRanker` and call `rank(present, absent=(), unknown=(), available=None, limit=10)`. Inputs are real HPO IDs. The API loads the validation-selected default method from `inference_config.json`. It reports tied rank ranges and compatibility scores, not disease probabilities. Ranking uses present phenotypes; absent phenotypes are excluded from additional observation requests and unresolved unknown states may be reassessed. Unrecorded disease annotations remain unknown.

The observation algorithm uses frequency-aware expected information gain with an availability mask. Evaluations use simulated outcomes, conditional top-20 coverage and optimistic ascertainability. These results do not establish clinical utility. Research API integration is available; a complete dashboard and clinical readiness are not claimed.

Original legacy training and prediction remain in `scripts/final_gpu_training.py` and `scripts/predict.py` for reproducibility. Use the improved entrypoints above for the new model. Do not run the legacy trainer to update new artifacts.
