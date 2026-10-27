# DiseaseMimic AI

This project provides source-data integration, CUDA-only phenotype-profile HGNN and EBM research ranking, and next-observation recommendations. The responsive manual-symptom dashboard is available in `frontend/`; clinical evaluation is not implemented. Ranking experiments use masked source annotations rather than independent patient records.

The current research workflow is documented in [ARCHITECTURE_IMPROVEMENT.md](ARCHITECTURE_IMPROVEMENT.md). New results live under `runs/architecture-improvement/`; earlier GPU results and checkpoints remain preserved. The sections below also retain the original data-integration and five-epoch project history.

## Dataset setup

With Python 3.12 and dependencies installed in a virtual environment:

```powershell
cd C:\Users\Admin\.vscode\DiseaseMimic-AI
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python scripts/download_datasets.py
python scripts/preprocess_datasets.py
python scripts/validate_datasets.py
```

This workspace also has its own embedded Python and isolated `.packages` installation. It does not modify either existing project. Run the complete acquisition/preprocessing/validation sequence with:

```powershell
.\setup_datasets.ps1
```

If Windows disables PowerShell scripts, use the equivalent Python command (no execution-policy changes required):

```powershell
& .\.runtime\python\python.exe run.py scripts/setup_datasets.py
```

Or run individual commands:

```powershell
& .\.runtime\python\python.exe run.py scripts/download_datasets.py
& .\.runtime\python\python.exe run.py scripts/preprocess_datasets.py
& .\.runtime\python\python.exe run.py scripts/validate_datasets.py
& .\.runtime\python\python.exe run.py scripts/run_tests.py
& .\.runtime\python\python.exe run.py scripts/train_models.py --epochs 5
& .\.runtime\python\python.exe run.py scripts/verify_model.py
& .\.runtime\python\python.exe run.py scripts/research_overlap.py HP:0001250 HP:0001249
```

Dataset setup checks existing downloads against their saved SHA256, avoiding unnecessary transfers. Delete the relevant local raw file to request a fresh upstream version, then rerun all three steps. Reprocessing changes data fingerprints, so train a fresh model afterward. Public downloads use no account or credentials. Authentication failures are reported and stop setup; no access controls are bypassed. Network timeouts and selected transient HTTP failures receive bounded retries. Errors are printed and saved in the manifest.

## Official sources and reuse

- HPO ontology: https://purl.obolibrary.org/obo/hp.obo
- HPO disease annotations: https://purl.obolibrary.org/obo/hp/hpoa/phenotype.hpoa
- Orphadata phenotype dataset: https://sciences.orphadata.com/phenotypes/ (English `en_product4.xml`). Public direct XML download, CC BY 4.0.
- Orphadata alignment dataset: https://www.orphadata.com/_alignments/ (English `en_product1.xml`). Public direct XML download, CC BY 4.0.

This project uses the Human Phenotype Ontology Consortium's ontology and annotations; see the recorded source release dates in `data/metadata/dataset_manifest.json`. Acknowledge and cite the Consortium, show source version/date, and preserve original HPO content and logical relationships. See https://hpo.jax.org/license and https://github.com/Human-Phenotype-Ontology/Human-Phenotype-Ontology.github.io/blob/master/license.md. The raw files are stored unchanged; normalized tables are derived research views with source metadata.

Orphanet/INSERM provides the Orphadata files under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribute Orphanet and indicate modifications: this project normalizes identifiers, integrates assertions, deduplicates records, and generates hypergraphs. Orphanet does not endorse this project. Original XML availability/license blocks remain in raw files.

## Outputs and semantics

`data/raw/hpo/` stores `hp.obo` and `phenotype.hpoa`; `data/raw/orphadata/` stores both official XML files. The manifest records URLs, actual local paths, sizes, SHA256, download dates, versions and measured counts. `data/metadata/download_verification.md` is the readable verification report. `processing_report.json` contains mapping coverage, unmatched disease identifiers, split counts and limitations. `validation_report.json` records executed checks.

`data/processed/` contains:

- `diseases.csv`: canonical disease ID, source names, original IDs, provenance and identity-group split.
- `phenotypes.csv`: active HPO IDs, names, normalized names, raw synonyms, extracted synonym labels, alternate IDs, parent IDs and raw relationships. `ontology_terms.csv` preserves all terms including obsolete records.
- `source_annotations.csv`: per-source assertions with original disease/HPO IDs, evidence and annotation metadata, raw frequency and numeric bounds where the source supports them. Missing bounds remain empty, never imputed.
- `disease_phenotype.csv`: unique disease/phenotype/state keys with all supporting source assertions. Conflicting positive and excluded records both remain available.
- `disease_cross_references.csv`: complete original mapping assertions, including broad/narrow and ambiguous relationships.
- `unmatched_phenotypes.csv`: rejected unresolved/obsolete HPO identifiers with original evidence. No unsupported IDs are fabricated.
- `hypergraph_data.pt`: actual sparse incidence indices and ordered node dictionaries, plus the separate training-only incidence.

Explicit `NOT` and Orphadata excluded annotations represent absence; unspecified frequency does not negate an association. An unlisted association is unknown. Patient observations support present/absent/unknown and contradictory duplicate input raises an error. No unknown observation becomes an absent observation.

Only exact one-to-one OMIM/ORPHA alignments merge disease identities. Broader mappings remain cross references. Related ambiguous disease identities are grouped into the same split to reduce leakage. This does not establish clinical equivalence or guarantee the absence of every disease-family dependency. Mapping coverage is measured and unmatched IDs are listed; no name-based guesses are made. HPO itself contains Orphanet-derived annotations, so these sources are not independent clinical evidence.

## Hypergraph and training

Each disease profile forms one hyperedge containing its disease node and all nonconflicting positive phenotype nodes. Nodes communicate through the full profile using degree-normalized node-to-hyperedge-to-node aggregation. This is a higher-order profile representation rather than pairwise phenotype edges. The model has learned disease and phenotype embeddings, two trainable message-passing layers, dropout, AdamW regularization, and a learned energy network. Lower raw energy means greater learned compatibility; it is never labeled probability.

The full incidence is for inspection. Training uses **only `train_incidence_index`**, never the full incidence. Identity groups receive deterministic approximately 80/10/10 train/validation/test splits. The exact measured proportions can differ because related identifiers stay together. Held-out disease annotations are excluded from all training profiles and training messages.

Training first validates raw/processed checksums, evidence, references, splits and exact graph reconstruction. Masked subsets of real training profiles provide positive disease examples; filtered alternative disease identities provide contrastive ranking examples. These subsets are not independently observed patient cases and do not replace the source dataset. Contrastive candidates are not claimed to be clinically excluded diagnoses. No missing phenotype is sampled as an explicit absent observation. Source frequency bounds are retained for later research, not converted to a fabricated probability or used as a calibration procedure.

Checkpoints contain data fingerprints, seed, architecture and weights. `models/training_report.json` reports measured optimization losses and device. CUDA is used when available, with CPU fallback. The current short training run establishes executable optimization, not clinical utility. Disease-disjoint zero-shot performance requires additional architecture/evaluation work: the held-out disease identity embeddings are untrained. No accuracy or clinical validity is asserted.

`backend/knowledge_base.py` is the application data-access layer: it requires successful validation, checks processed file fingerprints and computes source-grounded phenotype overlap from actual files. `research_overlap.py` exercises that layer. This baseline is explicitly separate from learned energy scores. There is no hardcoded demonstration dataset or silent fallback. The `frontend/` directory now contains the live React research dashboard; see `frontend/README.md` for the current workflow.

DiseaseMimic AI is an experimental clinical research tool. It is not validated for diagnosis or clinical decision-making and must not replace qualified healthcare professionals.

## Executed verification in this workspace

The official download, preprocessing and validation commands were executed on 26 October 2026. The measured output has 10,680 canonical diseases, 19,894 active HPO ontology terms and 266,413 state-specific associations. The graph contains 265,660 nonconflicting positive pairs; 210,563 belong to training. Splits contain 8,502 training, 1,193 validation and 985 test diseases.

HPO-to-Orphadata mapping covered 6,555 of 12,880 original HPO disease identifiers. Orphadata-to-HPO mapping covered 4,355 of 4,357 identifiers; the two unmatched Orphadata diseases have no integrated HPO counterpart. Three obsolete/unresolved phenotype assertions were quarantined, and 20 positive/excluded conflicts were retained for inspection but excluded from positive hyperedges. See the processing report for every unmatched identifier.

All six integration tests passed; `data/metadata/test_report.json` records the result. Both networks were jointly optimized for five epochs on 8,464 eligible real training disease profiles. Ranking loss changed from 1.313334 to 1.309292; this is an optimization check, not a performance result. The checkpoint reload and finite forward pass passed with matching data fingerprints (`models/model_verification.json`). The real-data overlap CLI was also executed; its full provenance-bearing output is in `data/metadata/overlap_example.json`.


## Run the manual symptom dashboard

```powershell
& .\.runtime\python\python.exe run.py scripts/launch_dashboard.py
```

Open http://127.0.0.1:5173. See [frontend setup and tests](frontend/README.md) for separate backend/frontend commands. Predictions come from the unchanged trained CUDA ranker.
