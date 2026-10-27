# Pre-change diagnostic report

Written before implementing the new architecture. Inspected all project Python sources, original and GPU checkpoint schemas, dataset loading, graph construction, validation, scoring, inference and nine tests. Existing checkpoint hashes are recorded in preserved_checkpoints.json.

## Verified causes

1. models/hgnn_ebm.py allocates an independent trainable embedding for every disease and phenotype. Held-out disease nodes have degree zero in train_incidence_index; no training query or positive/negative label uses them. Their disease identities have no positive optimization signal. They only receive shared transforms and AdamW decay. There is no inductive disease encoder.
2. scripts/final_gpu_training.py propagates only the training graph, but the phenotype-overlap reference matrix includes every disease profile. The previous comparison is unequal information. This explains why known-profile overlap performs well while identity-only cold-start ranking fails; it does not establish HGNN inferiority under equal knowledge.
3. Training uses masked training profiles versus learned training identity nodes. Evaluation asks it to identify withheld identity nodes. This is a representation and distribution mismatch.
4. Previous average-rank handling feeds the average directly into Top-K and MRR. This is not expected performance under uniform tie breaking and can penalize tied baselines incorrectly. New metrics integrate uniformly over tied positions.
5. Previous validation loss averages softplus contrasts over every candidate, including the positive and phenotypically compatible candidates. It is not a direct ranking metric. New checkpoint selection uses validation MRR.

## Checks without evidence of a bug

Disease IDs use the graph's sorted disease_ids mapping consistently; phenotype offsets are len(disease_ids). Candidate embeddings [:nd] match the labels. Lower energy is trained with softplus(1+positive-negative), and ranking uses ascending energy. Checkpoint dimensions and dataset hashes are checked before loading. The training graph is reconstructed and checked against training-only associations by validate_datasets.py. Conflicting absent/present records are excluded from reference positives. Existing random negatives are training diseases and filter positive supersets; they are not clinical negative diagnoses. There is no evidence of reversed energy direction or shifted labels.

## Planned correction

Retain genuine sparse hypergraph message passing on training phenotype/profile hyperedges, remove disease-ID parameters, and construct disease representations by pooling permitted reference phenotypes. Add independent raw-phenotype EBM and HGNN EBM branches and a cosine HGNN ablation. Compare equal-information reference matching and a validation-tuned hybrid. Strictly withheld reference profiles will produce an explicit shared unknown representation, documenting the limits of a zero-shot task without disease side information. All existing checkpoints remain unchanged.

Old test results motivated redesign, so the new report will label evaluations exploratory. New masked queries use a predeclared seed, but these are not new independent patient data or an untouched disease cohort. No claim of confirmatory or clinical accuracy is justified.
