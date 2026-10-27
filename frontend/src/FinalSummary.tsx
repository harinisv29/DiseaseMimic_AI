import {ClinicalRecord} from './ClinicalParts';
import {clinicalNotice,reviewCategory,reviewCategories,isNonPhenotype} from './clinical';
import { useState } from "react";
import {
  CheckCircle2,
  Download,
  Edit3,
  FilePlus2,
  Info,
  LoaderCircle,
} from "lucide-react";
import { Button, Card } from "./components/ui";
import {
  Comparison,
  ConditionCard,
  FindingPills,
  RankChanges,
} from "./WorkspaceParts";
import type { Evidence, Observation } from "./api";
import type { CaseSnapshot } from "./session";
import {
  assessmentScope,
  completionReasons,
  formatTime,
  isUseful,
  researchDisclaimer,
  type Completion,
} from "./completion";
export default function FinalSummary({
  completion,
  initial,
  evidence,
  evidencePending,
  evidenceError,
  onRetryEvidence,
  names,
  onEdit,
  onNew,
  onDetails,
  questionLimit,
  answeredIds,
  phenotypeNames,
}: {
  completion: Completion;
  initial?: CaseSnapshot;
  evidence: Map<string, Evidence>;
  evidencePending: boolean;
  evidenceError: boolean;
  onRetryEvidence: () => void;
  names: Map<string, string>;
  onEdit: () => void;
  onNew: () => void;
  onDetails: (id: string) => void;
  questionLimit: number;
  answeredIds: string[];
  phenotypeNames: Map<string, string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const snapshot = completion.snapshot;
  const leaders = snapshot.response.rankings
    .slice(0, 3)
    .map((r) => evidence.get(r.disease_id))
    .filter((d): d is Evidence => !!d);
  const remaining = snapshot.response.next_observations.filter(
    (r) =>
      isUseful(r) &&
      !answeredIds.includes(r.phenotype_id) &&
      !snapshot.observations.some((o) => o.id === r.phenotype_id),
  );
  const labels = new Map<string, string>(phenotypeNames);
  evidence.forEach((d) =>
    d.phenotypes.forEach((p) => labels.set(p.id, p.label)),
  );
  async function download() {
    setError("");
    setExporting(true);
    try {
      if (evidenceError || evidencePending)
        throw new Error("Load reference evidence before exporting the report.");
      const { exportReport } = await import("./pdfReport");
      await exportReport(
        completion,
        initial,
        evidence,
        questionLimit,
        answeredIds,
        phenotypeNames,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Report export failed. Please retry.",
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="final-summary">
      <div className="summary-heading">
        <span className="summary-complete-icon">
          <CheckCircle2 size={25} />
        </span>
        <div>
          <span className="section-kicker">FINAL RESEARCH SUMMARY</span>
          <h1>Analysis Complete</h1>
          <p>
            Summary of conditions matching the available clinical observations.
          </p>
        </div>
        <span className="summary-timestamp">
          {formatTime(completion.completedAt)}
        </span>
      </div>
      <div className="summary-reason">
        <Info size={16} />
        <span>{completionReasons[completion.reason]}</span>
      </div>
      <div className="summary-actions">
        <Button disabled={exporting || evidencePending} onClick={download}>
          {exporting ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Download size={16} />
          )}
          Download PDF Report
        </Button>
        <Button variant="outline" onClick={onEdit}>
          <Edit3 size={15} />
          Edit Observations
        </Button>
        <Button variant="ghost" onClick={onNew}>
          <FilePlus2 size={15} />
          Start New Analysis
        </Button>
      </div>
      {error && (
        <div className="error-notice" role="alert">
          <span>{error}</span>
          {evidenceError && (
            <Button size="sm" onClick={onRetryEvidence}>
              Retry evidence
            </Button>
          )}
        </div>
      )}

      <ClinicalRecord observations={snapshot.observations} context={snapshot.clinicalContext}/>
      <Card className="summary-observations">
        <div className="summary-section-heading">
          <h2>Observations collected</h2>
          <span>
            {completion.answeredCount} follow-up questions answered · limit{" "}
            {questionLimit}
          </span>
        </div>
        <div className="summary-observation-groups">
          {(["present", "absent", "unknown"] as const).map((state) => (
            <section className={state} key={state}>
              <h3>
                {stateNames[state]}{" "}
                <span>
                  {
                    snapshot.observations.filter((o) => o.state === state)
                      .length
                  }
                </span>
              </h3>
              <FindingPills
                findings={snapshot.observations.filter(
                  (o) => o.state === state,
                )}
                empty="None recorded"
              />
            </section>
          ))}
        </div>
        <p>
          The current backend ranks present findings. Absent findings prevent
          repeat questions; unknown findings have not been resolved.
        </p>
      </Card>
      <section className="summary-conditions">
        <div className="summary-section-heading">
          <div>
            <h2>{"Final ranked conditions"}</h2>
            <p>
              Latest analyzed observations ·{" "}
              {formatTime(snapshot.analyzedAt || completion.completedAt)}
            </p>
          </div>
          <span>{snapshot.response.rankings.length} returned</span>
        </div>
        {evidenceError && (
          <div className="error-notice" role="alert">
            <span>
              Reference evidence is unavailable; the real model rankings are
              preserved.
            </span>
            <Button size="sm" onClick={onRetryEvidence}>
              Retry
            </Button>
          </div>
        )}
        {snapshot.response.rankings.length === 0 ? (
          <Card className="no-conditions">
            <h3>No matching conditions returned</h3>
            <p>
              The backend returned an empty candidate list. No disease
              conclusion is implied.
            </p>
          </Card>
        ) : (
          <div className="conditions-list">
            {snapshot.response.rankings.slice(0, showAll ? 20 : 5).map((r) => (
              <ConditionCard
                key={r.disease_id}
                ranking={r}
                disease={evidence.get(r.disease_id)}
                observations={snapshot.observations}
                onDetails={() => onDetails(r.disease_id)}
                selected={false}
                onCompare={() => {}}
                pending={evidencePending}
                summary
              />
            ))}
          </div>
        )}
        {snapshot.response.rankings.length > 5 && (
          <Button
            variant="outline"
            className="show-more"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll
              ? "Show top 5 conditions"
              : `Show all ${snapshot.response.rankings.length} conditions`}
          </Button>
        )}
      </section>
      <Card className="summary-block">
        <h2>Why these diseases overlap</h2>
        <p>
          Compare the top three source profiles. Shared associations support
          similarity; a missing association remains unknown.
        </p>
        <div className="summary-feature-comparison">
          {leaders.map((d) => {
            const positive = d.phenotypes.filter((p) => p.state === "present"&&!isNonPhenotype(p));
            const shared = positive.filter((p) =>
              leaders.some(
                (other) =>
                  other.id !== d.id &&
                  other.phenotypes.some(
                    (x) => x.id === p.id && x.state === "present",
                  ),
              ),
            );
            const unique = positive.filter((p) =>
              leaders.every(
                (other) =>
                  other.id === d.id ||
                  !other.phenotypes.some(
                    (x) => x.id === p.id && x.state === "present",
                  ),
              ),
            );
            return (
              <section key={d.id}>
                <h3>{d.label}</h3>
                <h4>Inheritance and other non-phenotype information</h4><FindingPills findings={d.phenotypes.filter(p=>p.state==='present'&&isNonPhenotype(p))}/><h4>Shared reference features</h4>
                <FindingPills findings={shared.slice(0, 8)} />
                <h4>Not documented in the other leading profiles</h4>
                <FindingPills findings={unique.slice(0, 6)} />
              </section>
            );
          })}
        </div>
        {leaders.length >= 2 && (
          <Comparison diseases={leaders} observations={snapshot.observations} />
        )}
      </Card>
      <Card className="summary-block">
        <h2>What changed during analysis?</h2>
        {initial && initial.id !== snapshot.id ? (
          <>
            <p>
              Initial step {initial.id} compared with final step {snapshot.id}.
              Scores are query-normalized and are not treated as comparable
              across different observations.
            </p>
            <RankChanges current={snapshot} previous={initial} names={names} evidence={evidence} />
          </>
        ) : (
          <p>
            No follow-up update was required. These are the initial real
            rankings for the submitted observations.
          </p>
        )}
      </Card>
      <Card className="summary-block uncertainty-block">
        <h2>Remaining uncertainty</h2>
        <p>
          Multiple conditions may remain compatible with these observations. The
          highest-ranked condition is not a confirmed diagnosis. Research
          compatibility scores are not disease probabilities.
        </p>
        <p>
          Missing annotations do not establish absence. Unknown findings remain
          unresolved. This source-profile model has not been clinically
          validated, and strict unseen-disease generalization remains limited.
        </p>
      </Card>
      <Card className="summary-block">
        <h2>Further clinical review</h2>
        <p>
          These are remaining observations returned by the backend, not
          prescriptions for tests or treatments.
        </p>
        <div className="review-groups">
          {reviewCategories.map((scope) => (
            <section key={scope}>
              <h3>
                {scope}
              </h3>
              {remaining.filter(
                (r) => reviewCategory(r.phenotype_id,labels.get(r.phenotype_id)||r.phenotype_id) === scope,
              ).length ? (
                remaining
                  .filter((r) => reviewCategory(r.phenotype_id,labels.get(r.phenotype_id)||r.phenotype_id) === scope)
                  .map((r) => (
                    <div className="review-finding" key={r.phenotype_id}>
                      <span>
                        {labels.get(r.phenotype_id) || r.phenotype_id}
                        <small>{r.phenotype_id} · {reviewCategory(r.phenotype_id,labels.get(r.phenotype_id)||r.phenotype_id)}</small>
                      </span>
                      <small>
                        {r.expected_information_gain_nats.toFixed(4)} nats
                      </small>
                    </div>
                  ))
              ) : (
                <p>No remaining observations returned in this category.</p>
              )}
            </section>
          ))}
        </div>
        <small>
          This conservative UI categorization is not a clinical validation or a
          guarantee that a finding can be self-assessed.
        </small>
      </Card>
      <p className="clinical-notice">{clinicalNotice}</p>
      <p className="summary-disclaimer">{researchDisclaimer}</p>
    </section>
  );
}
const stateNames = { present: "Present", absent: "Absent", unknown: "Unknown" };
