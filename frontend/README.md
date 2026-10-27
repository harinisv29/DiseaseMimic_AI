# DiseaseMimic AI research application

The application opens directly to phenotype entry. Search HPO terms or source synonyms, choose Present / Absent / Unknown, and select **Analyze Symptoms**. Results show actual ranked conditions, identifiers, raw compatibility scores, matching reference features and optional comparisons/graphs.

**New Analysis**, **History** and **About** restore the previous research navigation. There is no patient mode chooser, onboarding, timeline/history intake, encrypted-saving dialog or doctor-ready report workflow. Case history remains in browser memory. The existing optional follow-up reporting preference remains; it filters appropriate backend recommendations without adding onboarding.

Follow-up answers update the real backend rankings. **Finish Analysis** opens the research summary immediately, reusing unchanged analyzed inputs. The default five-answer cap, unknown-answer exclusions, automatic completion when recommendations end, history restoration and detailed research PDF are retained.

```powershell
& .\.runtime\python\python.exe run.py scripts/launch_dashboard.py
```

Open http://127.0.0.1:5173. The existing CUDA model, datasets, checkpoints and ranking API are reused. No retraining or dataset download is needed.

The backend currently ranks present findings only. Absent findings suppress repeated recommendations but do not penalize scores; unknown findings remain unresolved. Scores are research compatibility values, not disease probabilities or diagnoses.

```powershell
$nodeDirectory = (Get-ChildItem .\.runtime\node -Directory | Select-Object -First 1).FullName
$env:PATH = "$nodeDirectory;$env:PATH"
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test
```

The two active browser test files cover the restored research workflows. The retired patient workflow tests and complete pre-rollback implementation are preserved in the timestamped `rollback-backups` snapshot. Historical patient-upgrade documents/results remain preserved as historical artifacts. The read-only POST search/source adapters and local browser session boundary remain compatible and unchanged; no backend or training source was modified for the rollback.
