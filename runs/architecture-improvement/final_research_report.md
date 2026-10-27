# Architecture improvement research report

Results are exploratory source-profile retrieval experiments, not independent patient or clinical validation. Prior test aggregates motivated redesign.

## Diagnosis

The old model depended on untrained held-out disease-ID embeddings and compared them with a baseline allowed to see held-out reference profiles. No mapping or energy-direction reversal was found. Tie metrics and validation selection were corrected. See diagnostic_report.md for the pre-change audit.

## CUDA training

GPU: NVIDIA GeForce RTX 4070 SUPER; CUDA 13.0; BF16 dense MLP; FP32 sparse propagation.
Three-seed training duration: 102.65 seconds (optimization, validation, checkpointing).
Selected seed 44; best epoch 8; epochs run per seed: [22, 22, 23].
Peak GPU allocation: 254.21 MiB. Original checkpoints preserved by SHA256.

## Setting A: known reference profiles, 50% retained phenotypes

All six methods use the same candidate profiles and observations. HGNN propagation and model optimization see training diseases only. Inference encodes permitted reference profiles without disease-ID parameters.

| Model | Top-1 | Top-3 | Top-5 | MRR |
|---|---:|---:|---:|---:|
| overlap | 79.461% | 85.111% | 87.191% | 0.830312 |
| weighted | 79.461% | 85.111% | 87.191% | 0.830312 |
| hgnn | 76.066% | 84.038% | 87.064% | 0.808219 |
| ebm | 75.657% | 84.242% | 87.575% | 0.807978 |
| hgnn_ebm | 76.066% | 83.936% | 87.166% | 0.808733 |
| hybrid | 88.591% | 92.729% | 93.710% | 0.909431 |

Default method from validation only: **hybrid**; hybrid baseline overlap, weight 0.01.
Validation best matching baseline MRR: 0.842195; hybrid MRR: 0.911436.

Paired test MRR difference from validation-selected matching baseline (95% identity-cluster bootstrap CI):

- overlap: 0.000000, CI [0.0, 0.0].
- weighted: 0.000000, CI [0.0, 0.0].
- hgnn: -0.022093, CI [-0.04297203943133354, 0.0016319634160026908].
- ebm: -0.022334, CI [-0.04308982193470001, 0.001781988306902349].
- hgnn_ebm: -0.021579, CI [-0.042223021388053894, 0.001285917591303587].
- hybrid: 0.079119, CI [0.0656895712018013, 0.09374784678220749].

Hybrid adds a statistically resolved MRR gain under this bootstrap: True.
HGNN alone, raw EBM and HGNN+EBM ablations are reported separately; compare hgnn_ebm versus ebm before attributing benefit to hypergraph message passing.

## Setting B: strict reference-withheld disease generalization

All methods are denied held-out candidate associations. There are 2178 unseen candidates with identical empty representations. Unseen-only results cannot distinguish their labels; all-candidate and unseen-only metrics are in test_metrics.json. This is an information limit, not solved by assigning random disease IDs.

## Robustness and uncertainty

test_metrics.json includes every method at 100%,75%,50%,25% retention, unsupported injected phenotypes, Top-1/3/5, Recall@1/3/5/10, mean rank, MRR, bootstrap intervals and paired differences. seed_comparison.json reports three independent seeds. Test cases and condition seeds are fixed before training. Synthetic observations are not patient data.

## Next-observation simulation

| Policy | Entropy reduction (nats) | Effective candidate reduction | True-target posterior change |
|---|---:|---:|---:|
| information_gain | 0.101673 | 0.563576 | 0.029456 |
| random | 0.057063 | 0.357623 | 0.016933 |
| frequency | 0.068177 | 0.416995 | 0.017545 |

Eligible: 174 of 200 considered test cases; 32 simulated outcomes per case and policy. See observation_recommendation_metrics.json for paired intervals.

Frequency intervals use source evidence; unknown candidate annotations remain p=.5. The simulator conditions on target-in-top20 and oracle ascertainable annotations. Entropy changes can be negative for individual outcomes. This evaluates simulated ambiguity only and establishes no clinical utility.

## Integration status

The selected ranking method and observation recommender are available through scripts/predict_improved.py. CUDA is mandatory. Absent/unknown states and availability are explicit. Default selection is based on validation; neural complexity alone never triggers deployment. The backend is ready for research integration; there is no completed frontend dashboard or clinical readiness claim.

## Hypergraph attribution and seed robustness

HGNN+EBM minus raw EBM paired test MRR: {"mean": 0.0007547459099441767, "ci95": [-0.007154033984988928, 0.008278699591755867]}.

Independent training-seed results: {"hgnn": {"seeds": 3, "mrr_mean": 0.7979962825775146, "mrr_sample_std": 0.008891848847270012, "mrr_values": [0.7920600175857544, 0.7937093377113342, 0.8082194328308105]}, "ebm": {"seeds": 3, "mrr_mean": 0.8005496263504028, "mrr_sample_std": 0.00788666121661663, "mrr_values": [0.7922734022140503, 0.8013970851898193, 0.8079782724380493]}, "hgnn_ebm": {"seeds": 3, "mrr_mean": 0.800300121307373, "mrr_sample_std": 0.007430919446051121, "mrr_values": [0.7947114109992981, 0.7974559664726257, 0.8087330460548401]}}.

The old test and new test use different fixed phenotype masks and tie calculations; their raw MRR numbers are not a controlled before/after comparison. The six-method comparison within Setting A is controlled.

Inference ranks present observations only. Known absent states suppress completed observation recommendations; unknown states remain eligible for reassessment. No penalty for unrecorded phenotypes is introduced.


## Retention and unsupported-phenotype robustness

| Condition | Hybrid Top-1 | Hybrid MRR | Overlap MRR |
|---|---:|---:|---:|
| 100% retained | 98.220% | 0.988683 | 0.946750 |
| 75% retained | 92.905% | 0.943508 | 0.885983 |
| 50% retained | 88.591% | 0.909431 | 0.830312 |
| 25% retained | 72.557% | 0.770318 | 0.681608 |
| 50% retained + unsupported terms | 85.206% | 0.881266 | 0.825576 |

Injected terms are outside the target reference profile; unrecorded source terms are not confirmed clinically absent. This is a noise surrogate.

## Strict Setting B results

| Method | All-candidate Top-1 | All-candidate MRR | Unseen-only Top-1 | Unseen-only MRR |
|---|---:|---:|---:|---:|
| overlap | 0.00001% | 0.000234 | 0.04591% | 0.003794 |
| weighted | 0.00001% | 0.000234 | 0.04591% | 0.003794 |
| hgnn | 0.00000% | 0.000139 | 0.04591% | 0.003794 |
| ebm | 0.00000% | 0.000205 | 0.04591% | 0.003794 |
| hgnn_ebm | 0.00000% | 0.000161 | 0.04591% | 0.003794 |
| hybrid | 0.00000% | 0.000146 | 0.04591% | 0.003794 |

Hybrid 95% identity-cluster intervals: Top-1 [0.8638174533843994, 0.9059008955955505]; MRR [0.8903399705886841, 0.9253425002098083]. These intervals reflect query sampling, not model-selection or training-seed uncertainty.

The EBM/HGNN ablations share jointly optimized phenotype embeddings. Their difference is an inference-path ablation, not a separately trained causal isolation of hypergraph learning. The HGNN-specific paired difference is not statistically resolved.

The IDF query-coverage baseline ties plain overlap on noiseless source subsets: the target and all supersets attain full coverage under both weightings. IDF can change behavior with unsupported observations.

Final corrected training/validation/checkpointing: 102.65 s; preliminary preserved attempt: 101.35 s; combined: 204.00 s. Seeds and masks are fixed; CUDA sparse reductions can still exhibit floating-point nondeterminism.


## Final verification

All 20 tests passed in 21.10 seconds, including CUDA forward/backward, finite gradients, mapping, candidate direction, hard negatives, strict reference withholding, numerical ties, checkpoint reload, baseline preservation, missing observations, availability and next-observation selection. One PyTorch sparse-invariant warning was emitted; no test failed. Original checkpoint SHA256 values are unchanged. See checkpoint_verification.json and test_report.json.
