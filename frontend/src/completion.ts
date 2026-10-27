import patientReported from "./patient-reported-phenotypes.json";
import type { Observation, RankResponse } from "./api";
import type { CaseSnapshot } from "./session";
export type AssessmentMode = "patient" | "clinician";
export type CompletionReason =
  | "user"
  | "limit"
  | "no-recommendations"
  | "no-eligible"
  | "no-useful"
  | "labels-unavailable";
export type Completion = {
  snapshot: CaseSnapshot;
  completedAt: string;
  reason: CompletionReason;
  answeredCount: number;
};
export const patientScope = patientReported as Record<
  string,
  { label: string; matchedTerms: string[] }
>;
export const defaultQuestionLimit = (() => {
  const n = Number(import.meta.env.VITE_FOLLOWUP_LIMIT || 5);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 5;
})();
export function observationKey(observations: Observation[]) {
  return JSON.stringify(
    observations
      .map((o) => [o.id, o.state])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}
export function isUseful(r: RankResponse["next_observations"][number]) {
  return (
    Number.isFinite(r.expected_information_gain_nats) &&
    r.expected_information_gain_nats > 0
  );
}
export function assessmentScope(id: string): "patient" | "clinician" {
  return patientScope[id] ? "patient" : "clinician";
}
export function eligibleQuestions(
  response: RankResponse,
  mode: AssessmentMode,
  observations: Observation[],
  displayed: string[],
  answered: string[],
) {
  const excluded = new Set([
    ...observations.map((o) => o.id),
    ...displayed,
    ...answered,
  ]);
  return response.next_observations.filter(
    (r) =>
      isUseful(r) &&
      !excluded.has(r.phenotype_id),
  );
}
export const completionReasons: Record<CompletionReason, string> = {
  user: "You chose to finish with the available observations.",
  limit:
    "The configured follow-up limit was reached. This is a workflow limit, not a clinical certainty threshold.",
  "no-recommendations": "The backend returned no further observations.",
  "no-eligible":
    "No new follow-ups suitable for the selected reporting mode remain. Other findings are separated below for qualified review.",
  "no-useful":
    "The returned recommendations have no positive finite information gain. No validated positive numerical cutoff has been established.",
  "labels-unavailable":
    "Reference labels were unavailable, so additional questions were stopped. The latest real rankings are preserved.",
};
export const researchDisclaimer =
  "This application is an experimental disease-phenotype research tool. Rankings are not diagnoses or probabilities. Results must not be used to make medical decisions without qualified clinical evaluation.";
export function formatTime(iso: string) {
  return (
    new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " IST"
  );
}
