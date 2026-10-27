# Prospective usability and clinical evaluation plan

Status: protocol proposal only. No volunteers have been recruited, no responses collected, no satisfaction scores reported and no claim of a 9/10 outcome established.

## Consenting adult volunteer study

Recruit an initial formative sample of 8–12 consenting adults with varied digital and health literacy. Participation is voluntary; withdrawal has no consequence. Use only the three explicitly synthetic scenarios supplied in the app. Ask participants not to enter real medical information. Explain that this is an unvalidated demonstration and is not a source of care. Obtain separate consent for optional recording. Exclude emergency or real-patient assessment from the study.

Counterbalance scenario order. Give each participant the same tasks: select Patient Mode, enter or load the assigned synthetic symptoms, add the provided synthetic timeline/history, identify what is and is not known, answer an eligible question or finish gracefully, distinguish reported features from reference-only associations, and export/open the doctor report. Do not tell participants which disease result is “correct”; scenarios have no diagnostic ground truth.

Capture elapsed seconds for symptom entry, summary comprehension, report export and total workflow. Record completion, errors, assistance, backtracking and whether the participant can find Finish. Collect no real symptom text or identifying information in study logs. Use random study codes, consented retention and a documented deletion date.

For each item, rate **1 = strongly disagree, 2 = disagree, 3 = neutral, 4 = agree, 5 = strongly agree**:

| Item | Rating (1–5) | Optional comment |
| --- | --- | --- |
| I could enter and correct the synthetic symptoms easily. | Uncollected | |
| I understood what the results meant. | Uncollected | |
| I understood the uncertainty and the limits of rare-disease reference data. | Uncollected | |
| This would help organize information for a doctor conversation. | Uncollected | |
| I could distinguish a model suggestion from a diagnosis. | Uncollected | |
| The report was readable and useful for a doctor conversation. | Uncollected | |
| I could finish without answering more questions. | Uncollected | |

Use open questions: What was confusing? Which wording suggested more certainty than justified? Which findings did you think the patient actually reported? What information was missing? What would you change about the report?

Add comprehension tasks: explain why the first match is not a diagnosis; identify a reference-only feature; explain Unknown versus Not assessed; explain whether timeline/history changed the current model output; explain what to do if urgent symptoms occur. Record responses verbatim with consent, without scoring a participant's medical knowledge. Predefine a blinded rubric for correct distinctions and report exact denominators, missing data and assistance.

Analyze completion counts, time median/range, rating distributions and qualitative themes. Do not convert a small convenience sample into a clinical-trust score. Review confusing or harmful wording before further testing. Invite separate consented clinician review of report readability and whether a typical report can be read in about two minutes; record actual time rather than asserting it.

## Independent clinician evaluation

Recruit qualified clinicians independently of implementation. Provide versioned safety rules, source links, question policies and synthetic boundary cases. Review urgency coverage, false reassurance, false alarms, specificity of HPO mappings, history-versus-examination distinctions, terminology, inheritance provenance, report omissions and jurisdiction-specific escalation. Include new versus chronic symptoms, incomplete evidence, pediatric examples and unknown region. Record issues, revisions and dated sign-off. Passing software tests is not clinical approval.

Clinicians should also assess whether the tool supports communication without inducing inappropriate rare-disease anchoring or unnecessary investigations. Review how common causes missing from the collection are communicated. Do not deploy to real patients while this safety review is incomplete.

## Separate diagnostic-ranking validation

Design a preregistered, independent, ethically approved study using appropriate de-identified clinical cases and expert-adjudicated diagnoses, with consent/data agreements where required. Synthetic source-profile subsets are not a substitute for observed patients. Separate development, calibration and locked external test cohorts by patient and appropriate disease/site/time groups; guard against source-profile leakage.

Compare phenotype overlap and weighted baselines against the frozen HGNN/EBM hybrid. Report top-k retrieval, rank metrics, missing/contradictory findings, annotation availability, disease prevalence/coverage, performance for common versus rare explanations, subgroup uncertainty, unseen-disease limitations and confidence intervals. Include candidate omission and out-of-collection diagnoses. Do not label normalized scores as calibrated probabilities without a separate valid calibration design and evaluation.

Keep diagnostic ranking, urgent-pattern safety and patient usability as separate evaluation questions. Define intended use, clinically meaningful endpoints, sample-size justification, harms, stopping rules and independent review before recruitment. Publish unfavorable results and limitations along with favorable ones.
