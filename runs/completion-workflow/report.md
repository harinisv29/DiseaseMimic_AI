# Completion workflow fix ? verified results

Application: http://127.0.0.1:5173

## Root cause

The prior interface had an ongoing follow-up loop with no completion state, no question budget and no final-summary route. Its exclusion list followed the selected history branch, so restoring old steps could reintroduce previous prompts. It also displayed all backend findings without distinguishing ordinary patient reports from clinician-assessed findings.

## Implemented behavior

- Finish Analysis is available immediately after ranking, next to the current question, and during an in-flight analysis. Unchanged observations reuse the latest real response. Edited observations are ranked once before finishing. An in-flight Finish waits for that same response.
- Five answered questions is the default configurable UX limit. Progress says Question N of 5; merely displaying a question does not increment the answered count. Five answers automatically open Analysis Complete with no sixth request.
- The workflow also completes if recommendations are missing, already observed/displayed/answered, unsuitable for the chosen reporting mode, or have no positive finite information gain. There is no validated positive numerical gain cutoff, so none is introduced.
- Current-case history tracks all collected findings, displayed recommendations and answers across branches. Not Sure remains unknown; no unknown-to-absent coercion occurs.
- Patient mode is default. A conservative 30-entry UI allowlist was generated from exact existing HPO terms/synonyms, with every ID and label verified against the source CSV. Unclassified or advanced findings are separated into clinician review. This is a UI policy, not clinically validated self-assessment guidance. Clinician mode is explicit and still has the finite question cap.
- The final summary groups observations by state and shows actual final candidates, matches and source evidence, top-three shared/distinguishing features, initial-versus-final rank changes, uncertainty and separate review categories. It never treats the leading disease as confirmed.
- Download PDF Report produces an actual Unicode-capable local PDF with source-derived observations, raw scores, ranking identifiers, evidence/provenance, IST timestamps and the disclaimer. Export makes no new ranking call. Edit Observations and confirmed Start New Analysis are available.

## Execution evidence

All 22 frontend/browser tests passed (41.4 s), including actual model inference, early Finish, edited-input Finish, five Not Sure answers, no repeated questions, unsuitable findings, no recommendations, mobile summary, PDF download and parsed PDF content. All 20 existing backend/CUDA tests passed (21.29 s). TypeScript checking and production build passed. The final dependency audit reports zero vulnerabilities.

The verified PDF example and desktop/mobile screenshots are saved alongside this report. PDF parsing confirmed real HPO IDs, the actual top disease identifier and score, reference provenance, timestamp and research disclaimer.

Every checked original/improved checkpoint and all raw/processed dataset SHA256 hashes remain unchanged. The backend and trained ranking algorithm were not modified. Backend health remains ready on cuda:0 using the hybrid model.

## Remaining limitations

The existing ranker uses present findings only; absent findings suppress repeat recommendations but do not reduce ranking scores. Unknown findings remain unresolved. The patient-reportable allowlist is deliberately conservative and can lead to early completion; remaining findings are retained for qualified review. No clinical utility or diagnostic certainty is established by completion, ranking stability or information gain.
