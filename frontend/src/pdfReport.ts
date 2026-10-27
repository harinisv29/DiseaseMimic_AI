import {clinicalNotice,coverageNotice,provenanceText,emptyClinicalContext,profileEvidence,reviewCategory,reviewCategories,isNonPhenotype} from './clinical';
import type { Evidence } from "./api";
import type { CaseSnapshot } from "./session";
import { changedRanks } from "./session";
import {
  assessmentScope,
  completionReasons,
  formatTime,
  isUseful,
  researchDisclaimer,
  type Completion,
} from "./completion";
export async function exportReport(
  completion: Completion,
  initial: CaseSnapshot | undefined,
  evidence: Map<string, Evidence>,
  limit: number,
  answeredIds: string[],
  phenotypeNames: Map<string, string>,
) {
  const { jsPDF } = await import("jspdf");
  const font = await fetch(
    `${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`,
  );
  if (!font.ok)
    throw new Error("The report font could not be loaded. Please retry.");
  const bytes = new Uint8Array(await font.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: false });
  doc.addFileToVFS("NotoSans-Regular.ttf", btoa(binary));
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.setFont("NotoSans");
  doc.setProperties({
    title: "DiseaseMimic AI - Final Research Analysis",
    subject: `Actual observations and model rankings; completed ${completion.completedAt}`,
    author: "DiseaseMimic AI",
    creator: "DiseaseMimic AI research application",
  });
  let y = 21;
  const width = 174;
  const ensure = (height: number) => {
    if (y + height > 275) {
      doc.addPage();
      y = 21;
    }
  };
  function text(
    value: string,
    size = 10,
    color: [number, number, number] = [48, 68, 82],
  ) {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(value, width) as string[];
    for (const line of lines) {
      ensure(size * 0.45 + 2);
      doc.text(line, 18, y);
      y += size * 0.45 + 1;
    }
    y += 2;
  }
  function section(title: string) {
    ensure(20);
    y += 4;
    text(title, 13, [22, 107, 91]);
  }
  const snapshot = completion.snapshot;
  text("DiseaseMimic AI", 21, [21, 53, 70]);
  text("Analysis Complete - Final research summary", 14);
  text(
    "Summary of conditions matching the available clinical observations.",
    10,
  );
  text(`Completed: ${formatTime(completion.completedAt)}`);
  text(
    `Model response: ${formatTime(snapshot.analyzedAt || completion.completedAt)}`,
  );
  text(`Completion reason: ${completionReasons[completion.reason]}`);
  text(
    `Follow-up questions answered: ${completion.answeredCount}; configured UX limit: ${limit}.`,
  );
  text(clinicalNotice,10);text(coverageNotice,9);
  text(researchDisclaimer, 9, [118, 76, 49]);
  section("A. Observations collected");
  for (const state of ["present", "absent", "unknown"] as const) {
    const findings = snapshot.observations.filter((o) => o.state === state);
    text(`${state.toUpperCase()} (${findings.length})`, 11);
    if (!findings.length) text("None recorded.", 9);
    for (const o of findings)
      text(
        `${o.label} (${o.id}) | ${provenanceText(o)}${o.official_label && o.official_label !== o.label ? ` - Official HPO term: ${o.official_label}` : ""}`,
        9,
      );
  }
  text(
    "Rankings use present findings. Absent findings suppress repeat follow-ups; unknown findings remain unresolved.",
    9,
  );
  section("Optional clinical context — not ranking inputs");
  for(const [key,value] of Object.entries(snapshot.clinicalContext||emptyClinicalContext()))text(`${({onset:'Onset',duration:'Duration',familyHistory:'Family history',exposures:'Exposures',laboratory:'Previously documented laboratory findings'} as Record<string,string>)[key]}: ${value||'Not recorded'}`,9);
  text('Attribution and notes are user-recorded, not independently verified. Unknown / Not Assessed does not mean absent.',9);
  section("B. Final ranked conditions");
  if (!snapshot.response.rankings.length)
    text(
      "No candidates returned by the backend. No disease conclusion is implied.",
    );
  for (const r of snapshot.response.rankings) {
    const d = evidence.get(r.disease_id);
    const matched =
      d?.phenotypes.filter(
        (p) =>
          p.state === "present" &&
          snapshot.observations.some(
            (o) => o.id === p.id && o.state === "present",
          ),
      ) || [];
    const extra =
      d?.phenotypes.filter(
        (p) => p.state === "present" && !matched.some((m) => m.id === p.id),
      ) || [];
    ensure(35);
    text(
      `Rank ${r.best_tied_rank}${r.worst_tied_rank > r.best_tied_rank ? `-${r.worst_tied_rank} (tied)` : ""}: ${d?.label || r.disease_id}`,
      11,
    );
    text(
      `Identifier: ${r.disease_id} | Research compatibility score: ${r.score.toFixed(6)} | Method: ${snapshot.response.method}`,
      9,
    );
    text(
      `Matching phenotypes: ${matched.length ? matched.map((p) => `${p.label} (${p.id})`).join("; ") : "None documented, or reference evidence unavailable."}`,
      9,
    );
    text(
      `Additional positive reference associations (up to 12 of ${extra.length}): ${
        extra
          .slice(0, 12)
          .map((p) => `${p.label} (${p.id})`)
          .join("; ") || "None documented."
      }`,
      9,
    );
    if(d){const e=profileEvidence(d,snapshot.observations);text(`Reported findings without documented positive associations: ${e.unmatched.map(o=>o.label).join('; ')||'None'}. Missing annotation does not establish absence.`,9);text(`Inheritance and other non-phenotype reference information: ${e.nonPhenotype.map(p=>p.label).join('; ')||'Not documented'}. No individual inheritance pattern is inferred.`,9);}
    text(
      `Source provenance: ${d?.sources.join(", ") || "Unavailable"}. A compatible ranking is not a confirmed diagnosis.`,
      9,
    );
  }
  section("C. Why these diseases overlap");
  const leaders = snapshot.response.rankings
    .slice(0, 3)
    .map((r) => evidence.get(r.disease_id))
    .filter((d): d is Evidence => !!d);
  for (const d of leaders) {
    const positive = d.phenotypes.filter((p) => p.state === "present"&&!isNonPhenotype(p));
    const shared = positive.filter((p) =>
      leaders.some(
        (other) =>
          other.id !== d.id &&
          other.phenotypes.some((x) => x.id === p.id && x.state === "present"),
      ),
    );
    const distinct = positive.filter((p) =>
      leaders.every(
        (other) =>
          other.id === d.id ||
          !other.phenotypes.some((x) => x.id === p.id && x.state === "present"),
      ),
    );
    text(d.label, 11);
    text(
      `Shared reference features (up to 10): ${
        shared
          .slice(0, 10)
          .map((p) => `${p.label} (${p.id})`)
          .join("; ") || "None documented."
      }`,
      9,
    );
    text(
      `Not documented in the other leading profiles (up to 10): ${
        distinct
          .slice(0, 10)
          .map((p) => `${p.label} (${p.id})`)
          .join("; ") || "None documented."
      }`,
      9,
    );
  }
  text(
    "Missing reference associations remain unknown, not clinically absent.",
    9,
  );
  section("D. What changed during analysis?");
  if (initial && initial.id !== snapshot.id) {
    for (const row of changedRanks(snapshot.response, initial.response))
      text(
        `${evidence.get(row.id)?.label || row.id}: ${row.before === undefined ? "new in returned set" : row.after === undefined ? "no longer returned" : `rank ${row.before} to ${row.after}`}; previous score ${row.beforeScore?.toFixed(6)??"not returned"}; updated score ${row.afterScore?.toFixed(6)??"not returned"}; numerical difference ${row.beforeScore!==undefined&&row.afterScore!==undefined?(row.afterScore-row.beforeScore).toFixed(6):"not comparable because missing"}`,
        9,
      );
    text(
      "Scores are query-normalized. Numerical differences are audit values, not changes in disease probability or calibrated cross-query compatibility.",
      9,
    );
  } else
    text(
      "These are the initial actual model rankings; no follow-up re-ranking was required.",
      9,
    );
  section("E. Remaining uncertainty");
  text(
    "Multiple diseases may remain compatible. The highest-ranked disease is not confirmed. Scores are not diagnostic probabilities. Source-profile evaluation is exploratory and does not establish clinical accuracy. Missing annotations do not establish absence; unknown findings remain unresolved.",
    10,
  );
  section("F. Further clinical review");
  const remaining = snapshot.response.next_observations.filter(
    (r) =>
      isUseful(r) &&
      !answeredIds.includes(r.phenotype_id) &&
      !snapshot.observations.some((o) => o.id === r.phenotype_id),
  );
  const phenoNames = new Map<string, string>(phenotypeNames);
  evidence.forEach((d) =>
    d.phenotypes.forEach((p) => phenoNames.set(p.id, p.label)),
  );
  for (const scope of reviewCategories) {
    text(
      scope,
      11,
    );
    const entries = remaining.filter(
      (r) => reviewCategory(r.phenotype_id,phenoNames.get(r.phenotype_id)||r.phenotype_id) === scope,
    );
    if (!entries.length) text("None returned in this category.", 9);
    for (const r of entries)
      text(
        `${phenoNames.get(r.phenotype_id) || r.phenotype_id} (${r.phenotype_id}); expected information gain ${r.expected_information_gain_nats.toFixed(4)} nats.`,
        9,
      );
  }
  text(
    "The UI categorization is conservative and not clinical validation. Remaining findings are suggestions for qualified review, not prescriptions for tests or treatments.",
    9,
  );
  text("Source references: https://hpo.jax.org/ ; https://www.orphadata.com/ . Local source versions are listed in the research evaluation dashboard.",9);
  section("Research notice");
  text(researchDisclaimer, 9);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(110, 125, 135);
    doc.text(
      `DiseaseMimic AI | Research use only | Page ${page} of ${pages}`,
      18,
      288,
    );
  }
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `DiseaseMimic-analysis-${completion.completedAt.replace(/[:.]/g, "-")}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
