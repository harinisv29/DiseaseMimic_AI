# Architecture improvement research report

Results are exploratory source-profile retrieval experiments, not independent patient or clinical validation. Prior test aggregates motivated redesign.

## Diagnosis

The old model depended on untrained held-out disease-ID embeddings and compared them with a baseline allowed to see held-out reference profiles. No mapping or energy-direction reversal was found. Tie metrics and validation selection were corrected. See diagnostic_report.md for the pre-change audit.

## CUDA training

GPU: NVIDIA GeForce RTX 4070 SUPER; CUDA 13.0; BF16 dense MLP; FP32 sparse propagation.
Three-seed training duration: 101.35 seconds (optimization, validation, checkpointing).
Selected seed 44; best epoch 10; epochs run per seed: [22, 22, 25].
Peak GPU allocation: 219.96 MiB. Original checkpoints preserved by SHA256.

## Setting A: known reference profiles, 50% retained phenotypes

All six methods use the same candidate profiles and observations. HGNN propagation and model optimization see training diseases only. Inference encodes permitted reference profiles without disease-ID parameters.

| Model | Top-1 | Top-3 | Top-5 | MRR |
|---|---:|---:|---:|---:|
| overlap | 79.461% | 85.111% | 87.191% | 0.830312 |
| weighted | 79.413% | 85.119% | 87.221% | 0.830209 |
| hgnn | 75.861% | 84.242% | 86.860% | 0.808629 |
| ebm | 75.432% | 84.283% | 87.575% | 0.807080 |
| hgnn_ebm | 75.657% | 84.651% | 86.962% | 0.808414 |
| hybrid | 88.489% | 92.729% | 93.608% | 0.908806 |

Default method from validation only: **hybrid**; hybrid baseline weighted, weight 0.01.
Validation best matching baseline MRR: 0.844154; hybrid MRR: 0.911793.

Paired test MRR difference from validation-selected matching baseline (95% identity-cluster bootstrap CI):

- overlap: 0.000103, CI [-0.00044528397847898304, 0.0007782484171912074].
- weighted: 0.000000, CI [0.0, 0.0].
- hgnn: -0.021579, CI [-0.043370768427848816, 0.0021664148662239313].
- ebm: -0.023129, CI [-0.04380561783909798, 0.00041639377013780177].
- hgnn_ebm: -0.021795, CI [-0.042832113802433014, 0.0021029727067798376].
- hybrid: 0.078598, CI [0.0653650239109993, 0.09328578412532806].

Hybrid adds a statistically resolved MRR gain under this bootstrap: True.
HGNN alone, raw EBM and HGNN+EBM ablations are reported separately; compare hgnn_ebm versus ebm before attributing benefit to hypergraph message passing.

## Setting B: strict reference-withheld disease generalization

All methods are denied held-out candidate associations. There are 2178 unseen candidates with identical empty representations. Unseen-only results cannot distinguish their labels; all-candidate and unseen-only metrics are in test_metrics.json. This is an information limit, not solved by assigning random disease IDs.

## Robustness and uncertainty

test_metrics.json includes every method at 100%,75%,50%,25% retention, unsupported injected phenotypes, Top-1/3/5, Recall@1/3/5/10, mean rank, MRR, bootstrap intervals and paired differences. seed_comparison.json reports three independent seeds. Test cases and condition seeds are fixed before training. Synthetic observations are not patient data.

## Next-observation simulation

{
  "considered": 200,
  "eligible_target_in_top20_with_available_annotation": 174,
  "replicates_per_case": 32,
  "policies": {
    "information_gain": {
      "queries": 174,
      "mean_entropy_reduction_nats": 0.08435695618391037,
      "mean_effective_candidate_reduction": 0.5303874611854553,
      "mean_true_target_posterior_change": 0.026324305683374405
    },
    "random": {
      "queries": 174,
      "mean_entropy_reduction_nats": 0.048283591866493225,
      "mean_effective_candidate_reduction": 0.34320011734962463,
      "mean_true_target_posterior_change": 0.015165514312684536
    },
    "frequency": {
      "queries": 174,
      "mean_entropy_reduction_nats": 0.05641573294997215,
      "mean_effective_candidate_reduction": 0.3771882653236389,
      "mean_true_target_posterior_change": 0.015855563804507256
    }
  },
  "paired_entropy_improvement": {
    "random": {
      "paired_mean_entropy_gain": 0.03607336804270744,
      "ci95": [
        0.028065277263522148,
        0.04620238021016121
      ]
    },
    "frequency": {
      "paired_mean_entropy_gain": 0.02794121950864792,
      "ci95": [
        0.018896376714110374,
        0.037513893097639084
      ]
    }
  },
  "limitations": [
    "Conditional on target in top20; oracle availability uses remaining explicitly annotated target terms for all policies.",
    "Binary outcomes simulated from source frequency or documented .75 positive/.01 absent assumptions.",
    "Unrecorded candidate phenotype pairs use .5 unknown, never absent; synthetic uncertainty model may be miscalibrated.",
    "Entropy reduction is model-based and does not establish clinical usefulness."
  ]
}

Frequency intervals use source evidence; unknown candidate annotations remain p=.5. The simulator conditions on target-in-top20 and oracle ascertainable annotations. Entropy changes can be negative for individual outcomes. This evaluates simulated ambiguity only and establishes no clinical utility.

## Integration status

The selected ranking method and observation recommender are available through scripts/predict_improved.py. CUDA is mandatory. Absent/unknown states and availability are explicit. Default selection is based on validation; neural complexity alone never triggers deployment. The backend is ready for research integration; there is no completed frontend dashboard or clinical readiness claim.

## Hypergraph attribution and seed robustness

HGNN+EBM minus raw EBM paired test MRR: {"mean": 0.0013340781442821026, "ci95": [-0.006024430505931377, 0.008723904378712177]}.

Independent training-seed results: {"hgnn": {"seeds": 3, "mrr_mean": 0.7982305884361267, "mrr_sample_std": 0.009512054733932018, "mrr_values": [0.7920600175857544, 0.7934468388557434, 0.8091849684715271]}, "ebm": {"seeds": 3, "mrr_mean": 0.8004330396652222, "mrr_sample_std": 0.007173573132604361, "mrr_values": [0.7928289175033569, 0.8013900518417358, 0.8070799708366394]}, "hgnn_ebm": {"seeds": 3, "mrr_mean": 0.8001734614372253, "mrr_sample_std": 0.0072730593383312225, "mrr_values": [0.7946504354476929, 0.7974559664726257, 0.8084139823913574]}}.

The old test and new test use different fixed phenotype masks and tie calculations; their raw MRR numbers are not a controlled before/after comparison. The six-method comparison within Setting A is controlled.

Inference ranks present observations only. Known absent states suppress completed observation recommendations; unknown states remain eligible for reassessment. No penalty for unrecorded phenotypes is introduced.
