import {DifferentialEvidence,DifferentialTable} from './ClinicalParts';
import {profileEvidence,provenanceText,coverageNotice,isNonPhenotype} from './clinical';
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitCompareArrows,
  Info,
  Network,
  X,
} from "lucide-react";
import { Badge, Button, Card, Skeleton } from "./components/ui";
import type { Evidence, Observation, RankResponse } from "./api";
import { changedRanks, type CaseSnapshot } from "./session";
const ReferenceGraph = lazy(() => import("./ReferenceGraph"));
export function FindingPills({
  findings,
  empty = "None documented",
}: {
  findings: { id: string; label: string }[];
  empty?: string;
}) {
  return (
    <div className="finding-pills">
      {findings.length ? (
        findings.map((p) => (
          <span key={p.id} title={p.id}>
            {p.label}
          </span>
        ))
      ) : (
        <span className="no-finding">{empty}</span>
      )}
    </div>
  );
}

export function ConditionCard({
  ranking,
  disease,
  observations,
  onDetails,
  selected,
  onCompare,
  pending,
  summary = false,
}: {
  ranking: RankResponse["rankings"][number];
  disease?: Evidence;
  observations: Observation[];
  onDetails: () => void;
  selected: boolean;
  onCompare: () => void;
  pending: boolean;
  summary?: boolean;
}) {
  const matches = disease?.phenotypes
    .filter(
      (p) =>
        p.state === "present" &&
        observations.some((o) => o.id === p.id && o.state === "present"),
    )
    .map((p) => ({
      ...p,
      label: observations.find((o) => o.id === p.id)?.label || p.label,
    }));
  const extra = disease?.phenotypes.filter(p=>!isNonPhenotype(p)).filter(
    (p) =>
      p.state === "present" &&
      !observations.some((o) => o.id === p.id && o.state === "present"),
  );
  return (
    <article className="condition-card">
      <div className="condition-top">
        <span
          className={`condition-rank ${ranking.best_tied_rank === 1 ? "first" : ""}`}
          title={`Tied positions ${ranking.best_tied_rank} to ${ranking.worst_tied_rank}`}
        >
          {ranking.best_tied_rank}
          {ranking.worst_tied_rank > ranking.best_tied_rank
            ? `–${ranking.worst_tied_rank}`
            : ""}
        </span>
        <div className="condition-title">
          <button onClick={onDetails}>
            {disease?.label || ranking.disease_id}
          </button>
          <small>{ranking.disease_id}</small>
        </div>
        <div className="condition-score">
          <span title="Research compatibility score, not a disease probability">
            Compatibility score
          </span>
          <strong>{ranking.score.toFixed(4)}</strong>
        </div>
      </div>
      <div className="condition-matches">
        <span className="small-label">
          <CheckCircle2 size={13} />
          Matching observations
        </span>
        {matches ? (
          <FindingPills findings={matches} />
        ) : pending ? (
          <Skeleton className="h-6 w-48" />
        ) : (
          <span className="muted-text">Reference evidence unavailable</span>
        )}
      </div>
      <p className="condition-reason">
        {matches
          ? matches.length
            ? `${matches.length} documented reference ${matches.length === 1 ? "association matches" : "associations match"} the present findings. The model also considers learned phenotype compatibility.`
            : "Included by model compatibility; no direct positive reference match was found for the present findings."
          : "Reference details are loading or unavailable; this ranking is the actual model response."}
      </p>
      {extra && extra.length > 0 && (
        <div className="additional-features">
          <span>Also associated:</span>
          {extra.slice(0, 3).map((p) => (
            <span title={p.id} key={p.id}>
              {p.label}
            </span>
          ))}
          {extra.length > 3 && <span>+{extra.length - 3} more</span>}
        </div>
      )}
      {disease&&<DifferentialEvidence disease={disease} observations={observations}/>}
      <div className="condition-footer">
        {!summary && (
          <label>
            <input
              type="checkbox"
              checked={selected}
              onChange={onCompare}
              aria-label={`Compare ${disease?.label || ranking.disease_id}`}
            />
            Compare
          </label>
        )}
        <Button variant="ghost" size="sm" onClick={onDetails}>
          View Details
          <ChevronRight size={14} />
        </Button>
      </div>
    </article>
  );
}

export function DiseaseDrawer({
  disease,
  id,
  observations,
  others,
  onClose,
}: {
  disease?: Evidence;
  id: string | null;
  observations: Observation[];
  others: Evidence[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (id) {
      setFilter("");
      if (!ref.current?.open) ref.current?.showModal();
    } else ref.current?.close();
  }, [id]);
  const positive =
    disease?.phenotypes.filter((p) => p.state === "present") || [];
  const matched = positive.filter((p) =>
    observations.some((o) => o.id === p.id && o.state === "present"),
  );
  const absent = positive.filter((p) =>
    observations.some((o) => o.id === p.id && o.state === "absent"),
  );
  const shared = positive.filter((p) =>
    others.some((d) =>
      d.phenotypes.some((v) => v.id === p.id && v.state === "present"),
    ),
  );
  const distinct = positive.filter(
    (p) =>
      others.length > 0 &&
      others.every(
        (d) =>
          !d.phenotypes.some((v) => v.id === p.id && v.state === "present"),
      ),
  );
  return (
    <dialog
      className="details-drawer"
      ref={ref}
      aria-labelledby="disease-drawer-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="drawer-inner">
        <div className="drawer-heading">
          <div>
            <span className="eyebrow">CONDITION DETAILS</span>
            <h2 id="disease-drawer-title">{disease?.label || id}</h2>
            <small>{id}</small>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close condition details"
            onClick={() => ref.current?.close()}
          >
            <X size={19} />
          </Button>
        </div>
        {!disease ? (
          <p className="drawer-loading">
            Reference evidence is loading or unavailable. Close this panel and
            retry reference loading if needed.
          </p>
        ) : (
          <>
            <div className="source-strip">
              Source provenance <strong>{disease.sources.join(" + ")}</strong>
            </div>
            <section className="drawer-section">
              <h3>Matches the patient’s present observations</h3>
              <FindingPills findings={matched} />
            </section>
            {absent.length > 0 && (
              <section className="drawer-section">
                <h3>Observed absent, associated in reference</h3>
                <FindingPills findings={absent} />
                <p>
                  The current ranking model uses present observations only;
                  these absent findings do not reduce its score.
                </p>
              </section>
            )}
            <section className="drawer-section"><h3>Reported findings without documented associations</h3><FindingPills findings={profileEvidence(disease,observations).unmatched}/><p>Missing annotation does not establish absence.</p><h3>Inheritance and other non-phenotype information</h3><FindingPills findings={profileEvidence(disease,observations).nonPhenotype}/></section>
            <section className="drawer-section">
              <h3>Shared with leading candidates</h3>
              <FindingPills findings={shared.slice(0, 18)} />
            </section>
            <section className="drawer-section">
              <h3>Potential distinguishing features</h3>
              <FindingPills findings={distinct.slice(0, 18)} />
              <p>
                These associations are not documented in the other leading
                reference profiles. That does not establish their clinical
                absence.
              </p>
            </section>
            <section className="drawer-section">
              <h3>
                Reference phenotype associations{" "}
                <span>{disease.phenotypes.length}</span>
              </h3>
              <input
                className="reference-filter"
                aria-label="Filter reference phenotypes"
                placeholder="Find a reference feature…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="reference-list">
                {disease.phenotypes
                  .filter((p) =>
                    (p.label + " " + p.id)
                      .toLowerCase()
                      .includes(filter.toLowerCase()),
                  )
                  .map((p) => (
                    <div key={p.id}>
                      <span>
                        {p.label}
                        <small>
                          {p.id} · {p.sources.join(", ")}
                        </small>
                      </span>
                      <span className={`reference-status ${p.state}`}>
                        {p.state === "present"
                          ? "Associated"
                          : p.state === "absent"
                            ? "Explicitly absent"
                            : p.state === "conflicting"
                              ? "Conflicting annotations"
                              : "Unknown"}
                        {p.frequencies.length > 0 && (
                          <small title="Source frequency annotation, as recorded">
                            {p.frequencies.join(", ")}
                          </small>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
            <p className="drawer-note">
              <Info size={15} />
              Research compatibility is not a diagnosis or disease probability.
              Unrecorded reference features remain unknown.
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}

export function Comparison({
  diseases,
  observations,
}: {
  diseases: Evidence[];
  observations: Observation[];
}) {
  const [graph, setGraph] = useState(false);
  const rows = [
    ...new Map(
      diseases.flatMap((d) => d.phenotypes.map((p) => [p.id, p] as const)),
    ).values(),
  ].filter(p=>!isNonPhenotype(p)).sort(
    (a, b) =>
      Number(observations.some((o) => o.id === b.id)) -
        Number(observations.some((o) => o.id === a.id)) ||
      a.label.localeCompare(b.label),
  );
  return (
    <details className="comparison-disclosure">
      <summary>
        <GitCompareArrows size={17} />
        <span>Compare reference profiles</span>
        <small>{diseases.length} selected</small>
        <ChevronDown size={15} />
      </summary>
      {diseases.length < 2 ? (
        <p className="comparison-hint">
          Select two to five condition checkboxes to compare their documented
          features.
        </p>
      ) : (
        <div className="comparison-body">
          <DifferentialTable diseases={diseases} observations={observations}/>
          <p>
            Missing documentation is unknown, not confirmed clinical absence.
          </p>
          <div className="comparison-scroll">
            <table>
              <thead>
                <tr>
                  <th>Phenotype</th>
                  {diseases.map((d) => (
                    <th key={d.id}>{d.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 12).map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.label}
                      <small>
                        {observations.find((o) => o.id === p.id)
                          ? `Observed ${observations.find((o) => o.id === p.id)?.state}`
                          : p.id}
                      </small>
                    </td>
                    {diseases.map((d) => {
                      const state = d.phenotypes.find(
                        (x) => x.id === p.id,
                      )?.state;
                      return (
                        <td key={d.id}>
                          <span
                            className={`reference-status ${state || "unknown"}`}
                          >
                            {state === "present"
                              ? "Associated"
                              : state === "absent"
                                ? "Explicitly absent"
                                : state === "conflicting"
                                  ? "Conflicting"
                                  : "Not documented"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setGraph((v) => !v)}>
            <Network size={15} />
            {graph ? "Hide connection graph" : "Explore connections"}
          </Button>
          {graph && (
            <Suspense fallback={<Skeleton className="h-80 w-full" />}>
              <ReferenceGraph diseases={diseases} observations={observations} />
            </Suspense>
          )}
        </div>
      )}
    </details>
  );
}

export function RankChanges({
  current,
  previous,
  names,
  evidence,
}: {
  current: CaseSnapshot;
  previous?: CaseSnapshot;
  names: Map<string, string>;
  evidence?:Map<string,Evidence>;
}) {
  if (!previous) return null;
  const changes = changedRanks(current.response, previous.response);
  const changed = changes.some((r) => r.before !== r.after);
  return (
    <details className="rank-changes">
      <summary>
        <span>
          {changed
            ? "See how the rankings changed"
            : "No rank-position changes among the leading conditions"}
        </span>
        <ChevronDown size={15} />
      </summary>
      <div className="changes-body">
        <p>
          Compared with step {previous.id}. Scores are normalized per query. Raw numerical changes are shown for audit, not as calibrated changes in disease likelihood; scores across queries do not share a probability scale.
        </p>
        <div className="new-evidence"><strong>Newly recorded observations</strong><ul>{current.observations.filter(o=>!previous.observations.some(p=>p.id===o.id&&p.state===o.state)).map(o=><li key={o.id}>{o.label} ({o.id}): {o.state} · {provenanceText(o)}</li>)}</ul></div>
        {changes.map((r) => (
          <div key={r.id}>
            <span>{names.get(r.id) || r.id}</span>
            <div className="change-support">{(()=>{const d=evidence?.get(r.id);if(!d)return <small>Source evidence unavailable for this returned-set transition.</small>;const added=current.observations.filter(o=>!previous.observations.some(p=>p.id===o.id&&p.state===o.state));const e=profileEvidence(d,added);return <><small>Newly supporting observations: {e.matched.map(o=>o.label).join('; ')||'None documented'}</small><small>Newly conflicting observations with explicit source support: {e.conflicts.map(o=>o.label).join('; ')||'None documented'}</small></>;})()}</div>
            <strong>
              {r.before === undefined
                ? "New in returned set"
                : r.after === undefined
                  ? "No longer returned"
                  : `${r.before} → ${r.after}`}
            </strong>
            <small>Previous score: {r.beforeScore?.toFixed(6)??'Not returned'} · Updated score: {r.afterScore?.toFixed(6)??'Not returned'}{r.beforeScore!==undefined&&r.afterScore!==undefined?` · Numerical difference: ${(r.afterScore-r.beforeScore).toFixed(6)}`:''}</small>
            {r.before !== undefined && r.after !== undefined ? (
              r.after < r.before ? (
                <ArrowUp size={14} className="up" />
              ) : r.after > r.before ? (
                <ArrowDown size={14} />
              ) : (
                <span>—</span>
              )
            ) : r.before === undefined ? (
              <ArrowUp size={14} className="up" />
            ) : (
              <ArrowDown size={14} />
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
