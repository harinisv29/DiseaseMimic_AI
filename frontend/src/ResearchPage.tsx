import { BookOpen, Layers3, ExternalLink } from "lucide-react";
import { Badge, Card } from "./components/ui";
import { methodNames, type Metadata } from "./api";
const methods = ["overlap", "weighted", "hgnn", "ebm", "hgnn_ebm", "hybrid"];
export default function ResearchPage({ meta,evaluation=false }: { meta?: Metadata;evaluation?:boolean }) {
  return (
    <div className="page-content">
      <div className="section-intro">
        <div className="eyebrow">TRANSPARENT BY DESIGN</div>
        <h1>{evaluation?'Research evaluation':'Research methodology'}</h1>
        <p>
          What the model knows, what we measured, and where the evidence stops.
        </p>
      </div>
      <Card className="p-6 evaluation-boundary"><h2>Controlled disease-profile retrieval — not clinical performance</h2><p>No independently validated patient-case accuracy is available. Metrics below are copied from the saved evaluation report and compare real baselines under the stated reference-access protocol.</p><p>Dataset: {meta?.diseases?.toLocaleString('en-US')||'Unavailable'} diseases · {meta?.phenotypes?.toLocaleString('en-US')||'Unavailable'} HPO terms · {meta?.associations?.toLocaleString('en-US')||'Unavailable'} disease–phenotype associations.</p></Card>
      <div className="method-grid">
        <Card className="p-6">
          <BookOpen className="text-teal-700" />
          <h2>Source-grounded knowledge</h2>
          <p>
            Disease profiles are integrated from the Human Phenotype Ontology
            and Orphadata. Unrecorded associations remain unknown; missing
            documentation does not establish clinical absence.
          </p>
          <p>
            Candidate names, reference associations and source frequencies are
            retrieved from the existing local dataset.
          </p>
        </Card>
        <Card className="p-6">
          <Layers3 className="text-blue-600" />
          <h2>A matching-first hybrid</h2>
          <p>
            The backend combines phenotype matching with learned compatibility
            from a phenotype-profile hypergraph neural network and an
            energy-based model. Disease representations are constructed from
            permitted reference profiles.
          </p>
          <p>
            Hybrid weights and the default method were selected using validation
            data only. Lower internal energy corresponds to better
            compatibility; this interface displays the backend's
            higher-is-better ranking score.
          </p>
        </Card>
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">MEASURED EVALUATION</div>
            <h2>Known profiles · 50% phenotype retention</h2>
          </div>
          <Badge>Exploratory research</Badge>
        </div>
        {meta ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Top-1</th>
                    <th>Top-3</th>
                    <th>Top-5</th>
                    <th>MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((m) => {
                    const v = meta.evaluation.setting_A["0.5"]?.[m];
                    return (
                      <tr
                        key={m}
                        className={m === "hybrid" ? "highlight-row" : ""}
                      >
                        <td>{methodNames[m]}</td>
                        <td>
                          {v
                            ? `${(v.top_1 * 100).toFixed(2)}%`
                            : "Not available"}
                        </td>
                        <td>
                          {v
                            ? `${(v.top_3 * 100).toFixed(2)}%`
                            : "Not available"}
                        </td>
                        <td>
                          {v
                            ? `${(v.top_5 * 100).toFixed(2)}%`
                            : "Not available"}
                        </td>
                        <td>{v?.mrr.toFixed(5) || "Not available"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="card-footnote">
              Loaded from the saved evaluation report.{" "}
              {meta.evaluation.setting_A["0.5"]?.hybrid?.queries.toLocaleString(
                "en-US",
              )}{" "}
              held-out disease queries. Scores above describe evaluation
              performance, not individual diagnostic probabilities.
            </p>
          </>
        ) : (
          <div className="p-6">Research metadata is not available.</div>
        )}
      </Card>
      <div className="method-grid mt-6">
        <Card className="p-6">
          <h2>Two different information settings</h2>
          <p>
            <strong>Setting A — Known profiles.</strong> Every method can access
            the same candidate reference catalog at inference. Optimization and
            HGNN graph construction use training disease profiles only.
          </p>
          <p>
            <strong>Setting B — Strict unseen diseases.</strong> Held-out
            references are withheld from all methods. Without disease side
            information, unseen candidates have identical empty representations
            and cannot be distinguished.
          </p>
        </Card>
        <Card className="p-6">
          <h2>Limits of the evidence</h2>
          <p>
            Queries are masked source annotations, not independent patient
            records. Previous test aggregates informed redesign, so these
            evaluations are exploratory. The HGNN-specific improvement over the
            raw EBM is not statistically resolved.
          </p>
          <p>
            Recommendation results are simulated and conditional on candidate
            coverage and phenotype availability. They do not establish clinical
            utility or prescribe clinical tests.
          </p>
        </Card>
      </div>
      <Card className="p-6 mt-6">
        <h2>Dataset provenance & licensing</h2>
        {meta?.sources.map((s) => (
          <details className="source-item" key={s.name}>
            <summary>
              {s.name}
              <ExternalLink size={14} />
            </summary>
            <a href={s.source_url} target="_blank" rel="noreferrer">
              Official source
            </a>
            <p>{s.license}</p>
            <small>
              Source version:{" "}
              {typeof s.source_version === "string"
                ? s.source_version
                : JSON.stringify(s.source_version)}{" "}
              · Downloaded {s.downloaded_at}
            </small>
          </details>
        )) || <p>Source metadata is not available.</p>}
      </Card>
    </div>
  );
}
