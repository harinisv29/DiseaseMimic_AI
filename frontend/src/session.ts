import type {ClinicalContext} from './clinical';
import type { Observation, RankResponse, Snapshot } from "./api";
export type CaseSnapshot = Snapshot & {
  analyzedAt?: string;
  clinicalContext?:ClinicalContext;
  parentId: number | null;
  label: string;
  answered: string[];
  question?: { id: string; label: string; state: Observation["state"] };
};
export type Submission = {
  finish?: boolean;
  clinicalContext?:ClinicalContext;
  observations: Observation[];
  parentId: number | null;
  answered: string[];
  question?: CaseSnapshot["question"];
};
export function friendlyLabel(
  p: { label: string; synonyms?: string[] },
  query: string,
) {
  return (
    p.synonyms?.find(
      (s) => s.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
    ) || p.label
  );
}
export function changedRanks(current: RankResponse, previous: RankResponse) {
  return [
    ...new Set([
      ...current.rankings.map((r) => r.disease_id),
      ...previous.rankings.map((r) => r.disease_id),
    ]),
  ].map((id) => ({
    id,
    before: previous.rankings.find((r) => r.disease_id === id)?.best_tied_rank,
    after: current.rankings.find((r) => r.disease_id === id)?.best_tied_rank,
    beforeScore:previous.rankings.find(r=>r.disease_id===id)?.score,
    afterScore:current.rankings.find(r=>r.disease_id===id)?.score,
  }));
}
