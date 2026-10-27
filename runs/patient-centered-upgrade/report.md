# Patient-centered upgrade verification

Implemented incrementally against the existing local DiseaseMimic AI application on 26 October 2026. Running application: http://127.0.0.1:5173. The existing model reports `cuda:0` on NVIDIA GeForce RTX 4070 SUPER. No training, checkpoint overwrite or dataset download was performed.

## Executed checks

| Check | Observed result |
| --- | --- |
| Production frontend build | TypeScript and Vite build passed. |
| Full browser suite | **36 passed**, zero unexpected failures, zero skipped, zero flaky; original 22 regression tests retained. |
| Full backend suite | **24 passed**; existing CUDA forward/backward, inference and real-data tests retained. |
| Synthetic scenarios | All three executed against the real backend on `cuda:0`; requests, responses and top-three reference evidence saved in `real_scenarios.json`. |
| PDF generation | Three doctor-ready PDFs and the detailed clinician research PDF downloaded and parsed; actual observations, context, source comparisons, dates and disclaimers checked. |
| Preservation | **16 tracked checkpoint/raw/processed dataset files** match their pre-existing SHA-256 manifests, including the trained best model. See `preservation.json`. |
| Privacy | Explicit consent, encryption, wrong passphrase rejection, authenticated expiry metadata, expired-copy deletion, idle clearing, deletion and restoration of real analyzed history verified. Restored unchanged observations produced no extra prediction. |
| Safety policy | Explicit urgent flags, sudden-onset weakness interruption, India 112, unknown jurisdiction and unreviewed status checked. Software checks do not establish clinical safety. |

Backend tests emit existing PyTorch sparse-invariant and Starlette TestClient deprecation warnings. The frontend build emits dependency comment-annotation warnings. These did not fail the checks. An initial missing-dataset test encountered Windows temporary-directory permissions; the final test uses a nonexistent isolated workspace path and passes without moving or deleting real datasets.

## Implemented behavior

- Explicit Patient and Clinician Research modes; three-step patient symptom/timeline/history intake; responsive navigation and privacy controls.
- Optional clinical context stays outside `/rank`. The original endpoint receives only supported HPO observation arrays and limit; model behavior is preserved.
- Six evidence categories, patient-appropriate wording, exact evidence requirements for clinician findings, separate Not assessed records, and context-only answers that never establish specific phenotypes. Hearing-loss history cannot infer sensorineural hearing impairment.
- Immediate **Finish and View Summary**, default five answered questions, no repeated answered/unknown questions, automatic completion when no eligible question remains, and preserved history branches.
- Patient results labeled exploratory phenotype matches with rare-disease coverage limitations; raw scores remain available in Clinician Research Mode. Reported observations are separated from reference-only features. Evidence details include unmatched reported findings and documented inheritance without inferring individual genetic risk.
- HPO terminology explanations fetched from actual local ontology definitions, with HPO identifiers, source links and provenance. No LLM-generated clinical explanations.
- Separate source-backed **draft, unreviewed** urgent-pattern module. Ranking pauses before ordinary research questions when its rules trigger. Only explicitly synthetic scenarios can continue past a warning.
- Local doctor-ready PDF and preserved detailed research PDF, generated only on request without additional inference.
- Default memory-only state, optional consented AES-256-GCM device saving, PBKDF2-SHA256 passphrase derivation, configurable retention, deletion and idle clearing. Loopback browser-origin/token boundary, POST symptom search and disabled Uvicorn access logs. No analytics or compliance claim added.

## Files changed

| Files | Purpose |
| --- | --- |
| `frontend/src/App.tsx` | Mode selection, intake integration, separate answer state, finite workflow, privacy and urgent preflight. |
| `frontend/src/assessment.ts` | Validated optional context, modes, answer/evidence categories and explicit report language. |
| `frontend/src/questionPolicy.ts`, `completion.ts` | Conservative evidence mapping and patient question eligibility. |
| `frontend/src/safety.ts` | Versioned draft urgent rules and jurisdiction guidance, independent of model scores. |
| `frontend/src/PatientFeatures.tsx` | Mode chooser, intake, urgent notice, ontology explanations, synthetic scenarios, context summary and privacy dialog. |
| `frontend/src/privacy.ts` | Consent-gated encrypted persistence, validated loading, authenticated expiry and deletion. |
| `frontend/src/FinalSummary.tsx`, `WorkspaceParts.tsx` | Patient research boundaries, evidence provenance, comparisons and reporting integration. |
| `frontend/src/doctorReport.ts` | Concise doctor-ready PDF from actual entered information and reference evidence. |
| `frontend/src/api.ts` | Local browser session token, POST search and source terminology adapter. |
| `frontend/src/demo-cases.json`, `application.css` | Three source-ID-backed synthetic inputs and responsive patient UI. |
| `scripts/dashboard_api.py`, `dashboard_access.py`, `serve_dashboard.py` | Read-only source adapters, local browser boundary and access-log control. |
| `scripts/verify_patient_upgrade.py` | Reproducible hash checks and real CUDA scenario evidence capture. |
| `frontend/tests/patient.spec.ts`, existing two browser spec files | Added patient coverage; retained earlier regression coverage with explicit clinician entry and updated button labels. |
| `tests/test_dashboard_privacy.py` | Session boundary, expiry, uniqueness and missing-data failure checks. |
| `frontend/README.md`, `PATIENT_UPGRADE_PLAN.md`, `USABILITY_STUDY_PLAN.md` | Current workflow, implementation/privacy limits and prospective evaluation protocol. |
| `frontend/dist`, test output and this evidence directory | Generated build and verification artifacts. |

Original backend ranking/model files, trained checkpoints and datasets were preserved. No new application dependency was introduced. Formatting used a temporary tool outside the application dependency manifest.

## Evidence artifacts

- `browser-test-report.json`: complete Playwright result.
- `backend-test-report.json`: full backend test summary.
- `preservation.json`: expected and observed hashes for all 16 files.
- `real_scenarios.json`: real inference responses and source profiles; all inputs explicitly synthetic.
- `neuro-doctor.pdf`, `developmental-doctor.pdf`, `sensory-doctor.pdf`: actual generated doctor-ready reports.
- `final-analysis.pdf`: actual detailed clinician research report.
- `patient-*.png`: mobile mode selection, patient summaries and urgent interruption.

## Unresolved validation and deployment work

**No independent clinician review, clinical approval, diagnostic validation, legal compliance assessment or volunteer usability study has been completed.** The safety module remains explicitly unreviewed and the app is a synthetic-case demonstration. It cannot exclude emergencies. The design target of 9/10 has not been measured.

This collection overrepresents rare disease profiles and does not reliably cover common explanations. Compatibility is not disease probability. Clinical context is recorded for communication, not consumed by the ranking model. The question policy is conservative and partial; unclassified findings require qualified review. Synthetic scenarios have no independently established diagnosis and are not an accuracy benchmark.

The local token/origin boundary is not production authentication or clinician credential verification. Real deployment requires independently reviewed safety rules, authenticated access and roles, TLS, a deployment threat model, privacy/legal assessment, operational controls and prospective validation. Encrypted local storage does not protect an unlocked session on a compromised device. Expired copies are removed when the app runs; a closed browser cannot execute deletion. Exported PDFs and external backups are outside application deletion control. Historical development logs predate the new disabled access logging and were not represented as erased.

See [implementation and limitations](../../PATIENT_UPGRADE_PLAN.md) and [prospective study plan](../../USABILITY_STUDY_PLAN.md). No study responses or satisfaction scores were fabricated.
