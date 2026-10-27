# Manual symptom dashboard verification

The application is running at http://127.0.0.1:5173 with the existing CUDA hybrid ranker at http://127.0.0.1:8000.

- TypeScript checking and production build passed.
- All 11 browser tests passed, including actual manual symptom selection, natural HPO autocomplete, removal, multiple states, real inference, source-backed comparison and graph, positive/absent recommendation updates, history, mobile overflow checks, timeout/error preservation, missing/empty fields and unavailable-model states.
- All 20 original CUDA/backend tests passed.
- The final dependency audit reported zero vulnerabilities.
- Original and improved checkpoint hashes match the preserved verification records. All processed dataset hashes match the original manifest. No model was retrained or checkpoint overwritten.
- The browser suite compares displayed candidate identifiers with actual API responses. Mock responses are restricted to automated failure/empty-state tests. No fixture predictions are used by the application.

The original backend and model files remain unchanged. New read-only adapters are in scripts/dashboard_api.py, with scripts/serve_dashboard.py and scripts/launch_dashboard.py as launchers. Complete setup and separate-terminal commands are in frontend/README.md.

Ranking uses present observations. The current backend does not reduce scores based on absent findings; these prevent repeat recommendations. Unknown findings remain unresolved. History is browser-session memory. Raw scores and relative bars are not disease probabilities. Recommendation information gain is model-based research evidence, not an instruction to order tests.

Screenshots and machine-readable test results are saved alongside this report.
