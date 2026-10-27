# Preregistered evaluation protocol for this implementation

Frozen before training/test evaluation. Model weights and hybrid hyperparameters are selected solely on the existing validation disease identity groups; test outcomes are not used for selection. All results are exploratory because prior aggregate test performance motivated redesign. There are no real independent patient cases in these files.

## Setting A: known disease reference profiles

All 10,680 candidate reference profiles are permitted at inference for every method. Model optimization and HGNN graph construction use training diseases only; at inference an inductive encoder pools each permitted reference profile through the fixed learned phenotype encoder. Validation/test labels and query masks are never optimization inputs. Public HPO ontology is available, although the first new model does not use ontology propagation. Training IDF weights use training profiles only. Reference frequencies are source metadata, not learned from validation/test labels. Queries are deterministically masked source annotations, not independent patients. Reference/query overlap is intentional in this synthetic known-profile retrieval task. Each disease has one query per retention condition. All methods receive identical positive observations, exact candidate ordering and tie policy.

## Setting B: strict unseen diseases without reference associations

Validation/test disease reference profiles and disease-ID features are unavailable to ALL methods, at training and inference. Training graph and reference rows include training diseases only. With no external disease descriptor, held-out diseases have identical empty representations. All methods explicitly assign the same score to these unknown candidates. Reports include the all-disease universe and an unseen-only universe: in the latter no method can distinguish the candidates, so expected Top-K is K/N and MRR is H_N/N. Do not interpret Setting A inductive profile encoding as this strict no-side-information task.

## Metrics and selection

Six methods: raw overlap; training-IDF weighted query coverage; HGNN cosine; raw phenotype EBM; HGNN plus EBM; matching plus HGNN/EBM hybrid. Lower energies are better; exported similarity scores are their negatives. Exact ties receive uniform random ordering analytically: Top-K=(K-number_better)/number_tied clipped to [0,1], reciprocal rank is the mean reciprocal of all tied positions, mean rank is the mean tied position. Recall@K equals Top-K for the single designated source disease label.

Up to 150 epochs, patience 15, seeds 42/43/44. AdamW, clipping, CUDA-only forward/backward and evaluation. Validation MRR averaged across the three neural heads selects epochs. The best seed is chosen by validation MRR, never test results. Hybrid baseline (raw or weighted), nonnegative combination weight from {0,.01,.03,.1,.3,1}, and default method are chosen by validation MRR only. Default retains a matching baseline unless a neural method/hybrid exceeds the best baseline validation MRR by at least .001. Neural scores are standardized per query; matching scores are query-normalized.

Test retention 100%,75%,50%,25%; fixed masked queries use seed 20261026 independently of training seed. Incorrect-report condition adds max(1,20% of retained count) uniformly sampled terms outside the target's known positive/absent profile: these are injected unsupported observations, not asserted clinical negatives. Bootstrap 95% intervals use 500 CUDA resamples of identity groups, including paired model-minus-baseline MRR differences. Existing identity groups define train/validation/test separation. Conditions and both settings are reported separately. Seed robustness uses identical evaluation queries.

## Observation recommendation

Research-only Bayesian expected information gain over top candidate diseases. Candidate probabilities derive from normalized matching/hybrid scores; source frequency intervals are converted to midpoint probabilities when available. Positives without numeric frequencies use an explicit .75 simulation assumption; explicit absent associations use .01; unrecorded candidate/phenotype pairs remain unknown (.5), never absent. Known present/absent input observations are excluded; unknown observations can be reassessed. An availability mask is enforced.

Simulation uses up to 200 test diseases whose target occurs in the top 20, a shared availability set of remaining explicitly annotated target phenotypes, and 32 simulated binary outcomes per policy. Compare expected information gain against uniform random and highest candidate-weighted phenotype frequency. Report conditional eligibility, entropy reduction, true-target posterior change, and assumptions. Availability is oracle ascertainability and this makes the experiment optimistic; no clinical utility claim. No outcome is inferred from an unrecorded phenotype.
