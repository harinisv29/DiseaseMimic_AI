# Application redesign verification

Running application: http://127.0.0.1:5173. CUDA ranker and API docs: http://127.0.0.1:8000/docs.

The landing-page structure has been replaced with a compact application shell and two-panel workspace. The main view has symptom input, editable findings, actual conditions, one live follow-up question and a session timeline. Detailed research and measured evaluation remain in About. No dataset statistics or CUDA hardware information is shown in the primary workspace.

## Verified execution

- All 14 Playwright workflows passed (19.1 s), including real CUDA inference, friendly synonym selection, keyboard input, supported-state serialization, side-drawer details, sequential follow-ups, suppression of already answered unknowns, history restoration, branching, confirmation before reset, responsive mobile layout and error states.
- All 20 existing backend/CUDA tests passed (21.69 s).
- TypeScript checking and the production build passed. Rollup emitted informational comment-annotation warnings from Zod; the build succeeded.
- Backend health reports ready, cuda:0, hybrid, NVIDIA GeForce RTX 4070 SUPER.
- All verified original and improved checkpoints retain their prior SHA256 hashes. All processed dataset hashes match the original manifest. No model was retrained and no inference behavior was changed.

## Data and workflow integrity

Autocomplete returns actual HPO synonyms from the read-only dataset. A friendly label is chosen only when the entered phrase exactly matches a recorded synonym; the official term and HPO identifier remain visible. For example, the tested source record maps Joint pain to Arthralgia, HP:0002829.

Questions are selected only from the backend's returned recommendation list, preserving its order after excluding answers already recorded on the active branch. Yes, No and Not Sure map to present, absent and unknown, then call the real ranking API automatically. No second ranking or information-gain algorithm runs in the frontend. History restores the exact submitted findings and prior response while preserving later branches. New Analysis requires confirmation before discarding a case. Session data is not persisted to browser storage.

The existing model ranks present observations only. An absent response suppresses repeat questions without reducing disease scores; unknowns remain unresolved. The UI explains this limitation and reports actual rank changes, including unchanged rankings. Suggestions are optional observations for qualified review, not instructions to order tests. Compatibility scores are not probabilities or diagnoses.

## Artifacts

See verification.json, browser-tests.json, backend-tests.json, openapi.json and the desktop/mobile screenshots beside this report. Historical dashboard evidence under runs/dashboard-validation remains preserved. Launch and build instructions are in frontend/README.md.
