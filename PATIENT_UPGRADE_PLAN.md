# Patient-centered upgrade — implementation and review boundary

This is an incremental upgrade of the existing React/FastAPI application. Its scope is a hackathon demonstration using synthetic cases, not a clinical deployment. A 9/10 experience is a design target, not a measured rating.

## Inspected pipeline and preserved behavior

- `frontend/src/App.tsx`, `session.ts`, `completion.ts`: observations, finite follow-up state, history, Finish and result snapshots.
- `frontend/src/WorkspaceParts.tsx`, `FinalSummary.tsx`, `pdfReport.ts`, `ResearchPage.tsx`: evidence, comparisons, reporting and measured research limitations.
- `backend/app.py`, `backend/ranker.py`: existing `/health` and `/rank` contract and trained CUDA hybrid inference. Present observations affect compatibility; absent observations suppress repeat recommendations; unknown observations remain unresolved. Those semantics are preserved.
- `scripts/dashboard_api.py`, `serve_dashboard.py`: local dashboard adapters and loopback API launch.
- `models/profile_hgnn.py`, `models/hgnn_ebm.py`, training/evaluation scripts, checkpoint verification and dataset manifests: existing research infrastructure; no retraining or data download belongs to this upgrade.

## Incremental implementation order

1. Add explicit patient and clinician entry modes, preserving the clinician workspace.
2. Add validated, optional timeline/history context separately from HPO model observations.
3. Categorize recommendations, retain exact-wording evidence requirements, record broad patient history without inferring specific phenotypes, and distinguish Not assessed from Unknown.
4. Preserve immediate Finish, five-question default and session-wide exclusion of answered questions.
5. Add cautious patient results, source-backed terminology, transparent reported/reference provenance and doctor-ready PDF.
6. Add a separate draft urgent-pattern module, jurisdiction guidance and explicit unresolved clinical review.
7. Add optional encrypted device saving, consent, deletion, expiry and a local browser request boundary.
8. Exercise both modes, all three real-backend synthetic scenarios, PDF parsing, privacy, safety interruptions and existing regressions; verify checkpoint/dataset hashes.

## Clinical review required before real patient use

`frontend/src/safety.ts` is **draft-1, not independently clinician-reviewed**. No clinician sign-off, diagnostic validation or usability outcome has been fabricated. Source-backed rules and passing tests do not establish clinical safety. The application displays this boundary and pauses ranking when its limited urgent-pattern rules fire. Continuing that warning is available only for a labeled synthetic demonstration.

Rule sources checked during implementation:

| Explicit reported pattern | Source | Important implementation boundary |
| --- | --- | --- |
| Sudden weakness or facial drooping | [NHS stroke symptoms](https://www.nhs.uk/conditions/stroke/symptoms/) | Sudden onset plus reported weakness also triggers a draft warning; weakness alone does not establish stroke. |
| New severe breathing difficulty | [NHS shortness of breath](https://www.nhs.uk/symptoms/shortness-of-breath/) | The user must explicitly report the severe pattern; no severity is invented from an HPO label. |
| Sudden extremely severe headache | [NHS headaches](https://www.nhs.uk/symptoms/headaches/) | This explicit flag differs from an ordinary headache observation. |
| Fever, severe headache and stiff neck | [NHS meningitis](https://www.nhs.uk/conditions/meningitis/) | Warns about the reported combination, does not diagnose meningitis. |
| New seizure or current loss of consciousness | [NHS seizure guidance](https://www.nhs.uk/symptoms/what-to-do-if-someone-has-a-seizure-fit/) | Existing seizure history alone is not labeled a new emergency. |

Default jurisdiction is India; [Government of India ERSS](https://112.gov.in/faq) supports 112. Other/unconfigured jurisdictions receive a local-emergency-services instruction without an invented number. UK source phone numbers are not copied into Indian guidance. `VITE_DEPLOYMENT_COUNTRY=IN` sets the build default; the form provides an explicit Other choice.

Before deployment, qualified clinicians must review every rule, wording, false-positive/false-negative risk, pediatric implications, accessibility, geography and escalation path, then sign a dated versioned record. An empty or negative screen cannot exclude an emergency. This prototype is neither exhaustive triage nor a substitute for emergency services.

## Privacy and deployment boundary

- Assessment state and browser session tokens stay in memory by default. Search uses POST bodies rather than symptom-bearing query URLs. Uvicorn access logging is disabled. No third-party analytics or remote model calls receive symptoms.
- Optional manual saving requires consent and a passphrase of at least 12 characters. Web Crypto uses PBKDF2-SHA256 (210,000 iterations, random 16-byte salt) and AES-256-GCM (random 12-byte IV). Only an encrypted envelope is written to localStorage. Passphrases are not persisted. Forgotten passphrases cannot be recovered.
- User-selectable retention is 1 hour, 24 hours or 7 days, constrained to 1–168 hours in code. Expired saved copies are removed when the running app checks storage; a closed browser cannot execute deletion. Clear current assessment and Delete saved assessment are separate, explicit actions. Downloaded PDFs and browser/OS backups cannot be remotely erased by the app.
- In-memory idle clearing defaults to 30 minutes; configure `VITE_ASSESSMENT_IDLE_MINUTES`. API tokens expire after `DISEASEMIMIC_SESSION_SECONDS` (default 1800; bounded 60–7200).
- API binds to loopback. Allowed browser origins are localhost/127.0.0.1:5173; browser inference/search/term requests require an expiring memory token. Direct local scripts retain the established API contract. This is a local demo boundary, **not user authentication, clinician credential verification, production authorization or protection from other software on the device**.
- Production work remains: authenticated identity/roles, TLS, server session lifecycle, threat modeling, penetration testing, audited deployment controls, consent review, backup/deletion policy and legal/technical assessment. No HIPAA, GDPR or Indian DPDP compliance is claimed.
- Browser downloads are explicitly initiated and generated locally with the existing jsPDF library and bundled Noto Sans font. They contain sensitive user-entered information and must be handled accordingly.

## Known model and interaction limitations

The disease reference collection is heavily weighted toward rare diseases; common causes may be missing. Scores are uncalibrated research compatibility values, not probabilities. The first result is not a likely real-world diagnosis. Patient mode hides scores; clinician mode preserves raw scores and identifiers.

Timeline, age range, history, prior diagnoses, examination notes, lab notes and context-only follow-up answers are **not ranking inputs**. Specific clinical findings cannot be inferred from broad wording: a reported hearing-loss diagnosis does not establish sensorineural hearing impairment. The six-category policy is conservative and curated, not a validated comprehensive medical taxonomy; unfamiliar findings remain unclassified and clinician-only.

Not assessed records are retained separately from unknown model observations. A local history-only answer keeps the prior actual ranking response and inference timestamp, because no supported input changed. The five-question cap is a usability default, not a clinically validated stopping rule. Synthetic scenario labels provide no diagnostic ground truth, and no expected “favorable” prediction is encoded.

Inheritance shown is limited to explicit associations in loaded source profiles. No gene result, familial risk or patient inheritance pattern is inferred. Missing reference annotations remain unknown. The doctor report is organized for a brief review; unusually long user notes can increase its length. Reading time has not yet been measured.
