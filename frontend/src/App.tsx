import {ClinicalContextEditor} from './ClinicalParts';
import {emptyClinicalContext,clinicalNotice,coverageNotice,provenanceKinds,reviewCategory,reviewRationale} from './clinical';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Dna,
  FilePlus2,
  History,
  Info,
  Lightbulb,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  clearBrowserSession,
  formSchema,
  type Evidence,
  type FormValues,
  type Observation,
  type Phenotype,
} from "./api";
import { Badge, Button, Card, Input, Skeleton } from "./components/ui";
import {
  ConditionCard,
  Comparison,
  DiseaseDrawer,
  FindingPills,
  RankChanges,
} from "./WorkspaceParts";
import { friendlyLabel, type CaseSnapshot, type Submission } from "./session";
import {
  assessmentScope,
  defaultQuestionLimit,
  eligibleQuestions,
  isUseful,
  observationKey,
  patientScope,
  type AssessmentMode,
  type Completion,
  type CompletionReason,
} from "./completion";
const FinalSummary = lazy(() => import("./FinalSummary"));
const ResearchPage = lazy(() => import("./ResearchPage"));
const stateNames = { present: "Present", absent: "Absent", unknown: "Unknown" };
function currentView() {
  return location.hash === "#evaluation" ? "evaluation" : location.hash === "#summary"
    ? "summary"
    : location.hash === "#history"
      ? "history"
      : location.hash === "#about" || location.hash === "#methodology"
        ? "about"
        : "analysis";
}
function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <Info size={17} />
      <span>{message}</span>
      {retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
export default function App() {
  const [clinicalContext,setClinicalContext]=useState(emptyClinicalContext);
  const [evidenceNote,setEvidenceNote]=useState('');
  const [reviewProvenance,setReviewProvenance]=useState<'unspecified'|'patient-reported'|'clinician-confirmed'|'documented-record'>('unspecified');
  const [view, setView] = useState(currentView);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const mode:AssessmentMode="clinician";
  const [questionLimit, setQuestionLimit] = useState(defaultQuestionLimit);
  const [sessionDisplayed, setSessionDisplayed] = useState<string[]>([]);
  const [sessionAnswers, setSessionAnswers] = useState<Observation[]>([]);
  const answersRef = useRef<Observation[]>([]);
  const [questionFocus, setQuestionFocus] = useState<{
    snapshotId: number;
    id: string;
  } | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [finishQueued, setFinishQueued] = useState(false);
  const finishRequested = useRef(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [snapshots, setSnapshots] = useState<CaseSnapshot[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [names, setNames] = useState(new Map<string, string>());
  const [panelWidth, setPanelWidth] = useState(408);
  const resizing = useRef(false);
  const split = useRef<HTMLDivElement>(null);
  const searchRoot = useRef<HTMLDivElement>(null);
  const newDialog = useRef<HTMLDialogElement>(null);
  const counter = useRef(0);
  const caseGeneration = useRef(0);
  const lastSubmission = useRef<Submission | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { observations: [] },
  });
  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "observations",
    keyName: "formKey",
  });
  const observations = form.watch("observations");
  const current = snapshots.find((s) => s.id === active);
  const parent = snapshots.find((s) => s.id === current?.parentId);
  const dirty =
    observationKey(observations) !== observationKey(current?.observations || []);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30000,
  });
  const metadata = useQuery({
    queryKey: ["metadata"],
    queryFn: api.metadata,
    enabled: view === "about" || view === "evaluation",
    staleTime: 300000,
  });
  const online = health.data?.status === "ready" && !health.isError;
  const searchResults = useQuery({
    queryKey: ["vocabulary", debounced],
    queryFn: () => api.search(debounced),
    enabled: searchOpen && debounced.length >= 2,
    staleTime: 60000,
  });
  const ranking = useMutation({
    mutationFn: async (submission: Submission) => ({
      ...submission,
      generation: caseGeneration.current,
      response: await api.rank(submission.observations),
    }),
    onSuccess: (data) => {
      if (data.generation !== caseGeneration.current) return;
      const entry: CaseSnapshot = {
        id: ++counter.current,
        analyzedAt: new Date().toISOString(),
        parentId: data.parentId,
        observations: structuredClone(data.observations),
        response: data.response,
        answered: [...data.answered],
        question: data.question,
        clinicalContext:data.clinicalContext,
        label: data.question
          ? `${data.question.label}: ${data.question.state === "unknown" ? "Not sure" : stateNames[data.question.state]}`
          : data.parentId === null
            ? "Initial analysis"
            : "Edited observations",
      };
      setSnapshots((old) => [...old, entry]);
      setActive(entry.id);
      setCompareIds(
        data.response.rankings.slice(0, 3).map((r) => r.disease_id),
      );
      setShowAll(false);
      form.reset({ observations: entry.observations });
      setEditingSummary(false);
      if (
        data.question &&
        !answersRef.current.some((o) => o.id === data.question!.id)
      ) {
        const answer = {
          id: data.question.id,
          label: data.question.label,
          state: data.question.state,
        };
        answersRef.current = [...answersRef.current, answer];
        setSessionAnswers(answersRef.current);
      }
      const shouldFinish = data.finish || finishRequested.current;
      finishRequested.current = false;
      setFinishQueued(false);
      if (shouldFinish) completeAnalysis(entry, "user");
      else if (answersRef.current.length >= questionLimit)
        completeAnalysis(entry, "limit");
      else if (
        !entry.response.next_observations.length ||
        !entry.response.rankings.length
      )
        completeAnalysis(entry, "no-recommendations");
      else {
        setCompletion(null);
        navigate("analysis");
      }
    },
  });
  const candidateIds =
    current?.response.rankings.map((r) => r.disease_id) || [];
  const evidence = useQuery({
    queryKey: ["evidence", candidateIds],
    queryFn: () => api.evidence(candidateIds),
    enabled: candidateIds.length > 0,
    staleTime: 300000,
  });
  const recommendationIds =
    current?.response.next_observations.map((r) => r.phenotype_id) || [];
  const questionTerms = useQuery({
    queryKey: ["question-terms", recommendationIds],
    queryFn: async () => {
      const all = await Promise.all(
        recommendationIds.map((id) => api.search(id)),
      );
      return all.flat().filter((p) => recommendationIds.includes(p.id));
    },
    enabled: recommendationIds.length > 0,
    staleTime: 300000,
  });
  const byId = useMemo(
    () => new Map((evidence.data || []).map((d) => [d.id, d])),
    [evidence.data],
  );
  const leading =
    current?.response.rankings
      .slice(0, 3)
      .map((r) => byId.get(r.disease_id))
      .filter((d): d is Evidence => !!d) || [];
  const compared = compareIds
    .map((id) => byId.get(id))
    .filter((d): d is Evidence => !!d);
  const labels = useMemo(() => {
    const result = new Map<string, string>();
    evidence.data?.forEach((d) =>
      d.phenotypes.forEach((p) => result.set(p.id, p.label)),
    );
    questionTerms.data?.forEach((p) => result.set(p.id, p.label));
    observations.forEach((p) => result.set(p.id, p.label));
    return result;
  }, [evidence.data, observations, questionTerms.data]);
  const observedHistory = useMemo(
    () => snapshots.flatMap((s) => s.observations),
    [snapshots],
  );
  const nextQuestion = completion
    ? undefined
    : current && questionFocus && current.id === questionFocus.snapshotId
      ? current.response.next_observations.find(
          (r) => r.phenotype_id === questionFocus.id,
        )
      : undefined;
  const questionLabel = nextQuestion
    ? labels.get(nextQuestion.phenotype_id) ||
      patientScope[nextQuestion.phenotype_id]?.label ||
      nextQuestion.phenotype_id
    : "";
  useEffect(() => {
    if (
      !current ||
      view !== "analysis" ||
      completion ||
      editingSummary ||
      dirty ||
      ranking.isPending ||
      ranking.isError
    )
      return;
    if (answersRef.current.length >= questionLimit) {
      completeAnalysis(current, "limit");
      return;
    }
    if (!current.response.next_observations.length) {
      completeAnalysis(current, "no-recommendations");
      return;
    }
    if (!current.response.next_observations.some(isUseful)) {
      completeAnalysis(current, "no-useful");
      return;
    }
    if (
      questionFocus?.snapshotId === current.id &&
      current.response.next_observations.some(
        (r) => r.phenotype_id === questionFocus.id && isUseful(r),
      ) &&
      !answersRef.current.some((o) => o.id === questionFocus.id) &&
      (mode === "clinician" || assessmentScope(questionFocus.id) === "patient")
    )
      return;
    const eligible = eligibleQuestions(
      current.response,
      mode,
      [...observedHistory, ...current.observations],
      sessionDisplayed,
      answersRef.current.map((o) => o.id),
    );
    if (!eligible.length) {
      completeAnalysis(current, "no-eligible");
      return;
    }
    const candidate = eligible[0];
    if (
      !labels.has(candidate.phenotype_id) &&
      !patientScope[candidate.phenotype_id]
    ) {
      if (evidence.isPending || questionTerms.isPending) return;
      if (!labels.has(candidate.phenotype_id)) {
        completeAnalysis(current, "labels-unavailable");
        return;
      }
    }
    setQuestionFocus({ snapshotId: current.id, id: candidate.phenotype_id });
    setSessionDisplayed((old) =>
      old.includes(candidate.phenotype_id)
        ? old
        : [...old, candidate.phenotype_id],
    );
  }, [
    current,
    view,
    completion,
    editingSummary,
    dirty,
    ranking.isPending,
    ranking.isError,
    questionFocus,
    mode,
    questionLimit,
    sessionDisplayed,
    observedHistory,
    sessionAnswers,
    labels,
    evidence.isPending,
    evidence.isError,
    questionTerms.isPending,
  ]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setHighlight(-1);
    }, 220);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const listener = () => setView(currentView());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    const listener = (event: PointerEvent) => {
      if (!searchRoot.current?.contains(event.target as Node))
        setSearchOpen(false);
    };
    document.addEventListener("pointerdown", listener);
    return () => document.removeEventListener("pointerdown", listener);
  }, []);
  useEffect(() => {
    if (!evidence.data) return;
    setNames((old) => {
      const next = new Map(old);
      evidence.data.forEach((d) => next.set(d.id, d.label));
      return next;
    });
  }, [evidence.data]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (resizing.current && split.current) {
        const rect = split.current.getBoundingClientRect();
        setPanelWidth(Math.max(330, Math.min(540, e.clientX - rect.left)));
      }
    };
    const finish = () => {
      resizing.current = false;
      document.body.classList.remove("resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
  }, []);
  function completeAnalysis(snapshot: CaseSnapshot, reason: CompletionReason) {
    setQuestionFocus(null);
    setEditingSummary(false);
    setCompletion({
      snapshot:{...snapshot,clinicalContext:structuredClone(clinicalContext),observations:observationKey(observations)===observationKey(snapshot.observations)?structuredClone(observations):snapshot.observations},
      completedAt: new Date().toISOString(),
      reason,
      answeredCount: answersRef.current.length,
    });
    navigate("summary");
  }
  function finishAnalysis() {
    if (ranking.isPending) {
      finishRequested.current = true;
      setFinishQueued(true);
      return;
    }
    if (
      current &&
      observationKey(observations) === observationKey(current.observations)
    ) {
      completeAnalysis(current, "user");
      return;
    }
    void form.handleSubmit((values) =>
      submit({
        observations: structuredClone(values.observations),
        parentId: current?.id || null,
        answered: answersRef.current.map((o) => o.id),
        finish: true,
      }),
    )();
  }
  function editObservations() {
    setCompletion(null);
    setEditingSummary(true);
    setQuestionFocus(null);
    navigate("analysis");
    requestAnimationFrame(() =>
      document.getElementById("symptom-search")?.focus(),
    );
  }
  function navigate(next: string) {
    setView(next);
    location.hash = next === "analysis" ? "analysis" : next;
  }
  function add(p: Phenotype) {
    if (ranking.isPending) return;
    const item: Observation = {
      id: p.id,
      label: friendlyLabel(p, search),
      official_label: p.label,
      state: "present",
      provenance:{kind:"unspecified",note:"",recordedAt:new Date().toISOString()},
    };
    const index = observations.findIndex((o) => o.id === p.id);
    if (index < 0) append(item);
    setSearch("");
    setSearchOpen(false);
    setHighlight(-1);
    form.clearErrors();
  }
  function submit(payload: Submission) {
    payload.clinicalContext=structuredClone(clinicalContext);
    setSearchOpen(false);
    if (innerWidth < 900)
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({
          behavior: "auto",
          block: "start",
        }),
      );
    lastSubmission.current = structuredClone(payload);
    ranking.mutate(payload);
  }
  const analyze = form.handleSubmit((values) => {
    if(current&&!dirty&&(JSON.stringify(values.observations)!==JSON.stringify(current.observations)||JSON.stringify(clinicalContext)!==JSON.stringify(current.clinicalContext||emptyClinicalContext()))){setSnapshots(old=>old.map(entry=>entry.id===current.id?{...entry,observations:structuredClone(values.observations),clinicalContext:structuredClone(clinicalContext)}:entry));return;}
    submit({
      observations: structuredClone(values.observations),
      parentId: current?.id || null,
      answered: answersRef.current.map((o) => o.id),
    });
  });
  function answer(state: Observation["state"]) {
    if (!nextQuestion || !current || ranking.isPending || dirty) return;
    const finding: Observation = {
      id: nextQuestion.phenotype_id,
      label: questionLabel,
      state,
      provenance:{kind:reviewProvenance,note:evidenceNote.trim(),recordedAt:new Date().toISOString()},
    };
    const next = current.observations
      .filter((o) => o.id !== finding.id)
      .concat(finding);
    answersRef.current = [
      ...answersRef.current.filter((o) => o.id !== finding.id),
      finding,
    ];
    setSessionAnswers(answersRef.current);
    setEvidenceNote('');setReviewProvenance('unspecified');
    form.reset({ observations: next });
    submit({
      observations: next,
      parentId: current.id,
      answered: answersRef.current.map((o) => o.id),
      question: { id: finding.id, label: finding.label, state },
    });
  }
  function restore(entry: CaseSnapshot) {
    if (ranking.isPending) return;
    setActive(entry.id);
    setClinicalContext(entry.clinicalContext||emptyClinicalContext());
    setEvidenceNote('');
    setCompletion(null);
    setEditingSummary(true);
    setQuestionFocus(null);
    form.reset({ observations: structuredClone(entry.observations) });
    setCompareIds(entry.response.rankings.slice(0, 3).map((r) => r.disease_id));
    setShowAll(false);
    ranking.reset();
    setSearch("");
    navigate("analysis");
  }
  function clearCase() {
    setClinicalContext(emptyClinicalContext());setEvidenceNote('');setReviewProvenance('unspecified');
    caseGeneration.current++;
    clearBrowserSession();
    queryClient.removeQueries({
      predicate: (q) =>
        ["vocabulary", "evidence", "term"].includes(String(q.queryKey[0])),
    });
    form.reset({ observations: [] });
    setSnapshots([]);
    setCompletion(null);
    setSessionDisplayed([]);
    setSessionAnswers([]);
    answersRef.current = [];
    setQuestionFocus(null);
    setEditingSummary(false);
    setFinishQueued(false);
    finishRequested.current = false;
    setActive(null);
    setNames(new Map());
    setSearch("");
    setSearchOpen(false);
    setCompareIds([]);
    setDetailId(null);
    counter.current = 0;
    lastSubmission.current = null;
    ranking.reset();
    queryClient.getMutationCache().clear();
    newDialog.current?.close();
    navigate("analysis");
  }
  function newAnalysis() {
    if (observations.length || snapshots.length) newDialog.current?.showModal();
    else clearCase();
  }
  const retry = () => {
    if (lastSubmission.current && !ranking.isPending)
      ranking.mutate(lastSubmission.current);
  };
  const formError =
    form.formState.errors.observations?.message ||
    form.formState.errors.observations?.root?.message;
  const presentCount = observations.filter((o) => o.state === "present").length;
  return (
    <MotionConfig reducedMotion="user">
      <header className="app-header">
        <div className="header-content">
          <a
            href="#analysis"
            className="brand"
            onClick={() => navigate("analysis")}
          >
            <span className="brand-icon">
              <Dna size={22} />
            </span>
            <strong>
              DiseaseMimic <b>AI</b>
            </strong>
          </a>
          <nav aria-label="Application navigation">
            <button
              aria-label="New Analysis"
              onClick={newAnalysis}
              disabled={ranking.isPending}
            >
              <Plus size={15} />
              New Analysis
            </button>
            <button
              aria-label="History"
              className={view === "history" ? "active" : ""}
              onClick={() => navigate("history")}
            >
              <History size={15} />
              History{snapshots.length > 0 && <span>{snapshots.length}</span>}
            </button>
            <button onClick={()=>navigate("evaluation")} className={view==='evaluation'?'active':''}>Validation</button>
            <button
              aria-label="About"
              className={view === "about" ? "active" : ""}
              onClick={() => navigate("about")}
            >
              <Info size={15} />
              About
            </button>
          </nav>
          <span
            className={`backend-status ${online ? "connected" : "disconnected"}`}
            role="status"
          >
            <i />
            {online
              ? "Backend connected"
              : health.isPending
                ? "Connecting…"
                : "Backend unavailable"}
          </span>
        </div>
      </header>
      <main className="application">
        <div className="clinical-notice">{clinicalNotice}</div>
        <details className="clinical-safety"><summary>Scope, coverage and urgent-care limitations</summary><p>{coverageNotice}</p><p>This tool does not triage or exclude emergencies. Acute deterioration or suspected emergencies require established local urgent-care pathways, without waiting for research scores or follow-up review. No tests or treatments are ordered. Use synthetic or properly de-identified demonstration cases.</p></details>
        {
          <>
            {view !== "about" && view !== "evaluation" && view !== "history" && (
              <ol className="workflow-progress" aria-label="Analysis progress">
                {["Symptoms", "Analysis", "Follow-up", "Summary"].map(
                  (label, i) => (
                    <li
                      key={label}
                      className={
                        (completion && view === "summary"
                          ? 3
                          : ranking.isPending
                            ? 1
                            : current
                              ? 2
                              : 0) === i
                          ? "active"
                          : (completion && view === "summary"
                                ? 3
                                : current
                                  ? 2
                                  : 0) > i
                            ? "done"
                            : ""
                      }
                    >
                      <span>{i + 1}</span>
                      {label}
                      {i < 3 && <ChevronRight size={13} />}
                    </li>
                  ),
                )}
              </ol>
            )}
            {view === "summary" && completion ? (
              <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                <FinalSummary
                  completion={completion}
                  initial={snapshots[0]}
                  evidence={byId}
                  evidencePending={
                    evidence.isPending && candidateIds.length > 0
                  }
                  evidenceError={evidence.isError}
                  onRetryEvidence={() => evidence.refetch()}
                  names={names}
                  onEdit={editObservations}
                  onNew={newAnalysis}
                  onDetails={setDetailId}
                  questionLimit={questionLimit}
                  answeredIds={sessionAnswers.map((o) => o.id)}
                  phenotypeNames={labels}
                />
              </Suspense>
            ) : view === "about" || view === "evaluation" ? (
              <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                <ResearchPage meta={metadata.data} evaluation={view==='evaluation'}/>
                {metadata.isError && (
                  <ErrorNotice
                    message="Research metadata could not be loaded."
                    retry={() => metadata.refetch()}
                  />
                )}
              </Suspense>
            ) : view === "history" ? (
              <section className="history-page">
                <button
                  className="back-link"
                  onClick={() => navigate("analysis")}
                >
                  <ArrowLeft size={15} />
                  Back to analysis
                </button>
                <h1>Analysis history</h1>
                <p>
                  Review the observations and results at each step. History
                  stays in this browser session.
                </p>
                {snapshots.length === 0 ? (
                  <div className="history-empty">
                    <History size={24} />
                    <h2>No analyses yet</h2>
                    <p>Your timeline will appear after the first analysis.</p>
                    <Button onClick={() => navigate("analysis")}>
                      Enter observations
                      <ArrowRight size={15} />
                    </Button>
                  </div>
                ) : (
                  <div className="history-list">
                    {snapshots.map((entry) => (
                      <Card
                        className={`history-entry ${entry.id === active ? "current" : ""}`}
                        key={entry.id}
                      >
                        <div className="history-entry-heading">
                          <span className="step-number">{entry.id}</span>
                          <div>
                            <h2>{entry.label}</h2>
                            <p>
                              {entry.parentId
                                ? `Continues from step ${entry.parentId}`
                                : "First ranking"}{" "}
                              · {entry.observations.length} observations
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={ranking.isPending}
                            onClick={() => restore(entry)}
                          >
                            Restore step
                            <ArrowRight size={14} />
                          </Button>
                        </div>
                        <div className="history-findings">
                          {entry.observations.map((o) => (
                            <span className={o.state} key={o.id}>
                              {o.label}
                              <small>{stateNames[o.state]}</small>
                            </span>
                          ))}
                        </div>
                        <p className="history-leader">
                          Leading condition:{" "}
                          <strong>
                            {entry.response.rankings[0]
                              ? names.get(
                                  entry.response.rankings[0].disease_id,
                                ) || entry.response.rankings[0].disease_id
                              : "No candidates returned"}
                          </strong>
                        </p>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <>
                <div className="application-title">
                  <div>
                    <h1>DiseaseMimic AI</h1>
                    <p>
                      Enter patient observations to explore possible matching
                      conditions.
                    </p>
                  </div>
                  <span className="session-label">
                    <span />
                    Local session
                  </span>
                </div>
                {health.isError && (
                  <ErrorNotice
                    message="The backend is unavailable. Your observations are kept; reconnect and try again."
                    retry={() => health.refetch()}
                  />
                )}{" "}
                {!health.isPending &&
                  !health.isError &&
                  health.data?.status !== "ready" && (
                    <ErrorNotice
                      message="The model is not ready. Wait for model loading or restart the backend."
                      retry={() => health.refetch()}
                    />
                  )}
                <div
                  className={`analysis-split ${compact ? "is-compact" : ""}`}
                  ref={split}
                  style={
                    {
                      "--panel-width": `${panelWidth}px`,
                    } as React.CSSProperties
                  }
                >
                  <aside className="observation-panel">
                    <Card className="observation-card">
                      <div className="observation-panel-heading">
                        <div>
                          <span className="section-kicker">
                            PATIENT OBSERVATIONS
                          </span>
                          <h2>
                            {compact
                              ? "Observations"
                              : "What symptoms is the patient experiencing?"}
                          </h2>
                          {!compact && (
                            <p>
                              Search and select the patient’s symptoms or
                              clinical findings.
                            </p>
                          )}
                        </div>
                        <button
                          className="collapse-button"
                          onClick={() => setCompact((v) => !v)}
                          aria-label={
                            compact
                              ? "Expand observations panel"
                              : "Collapse observations panel"
                          }
                        >
                          {compact ? (
                            <ChevronsRight size={17} />
                          ) : (
                            <ChevronsLeft size={17} />
                          )}
                        </button>
                      </div>
                      {compact ? (
                        <div className="collapsed-observations">
                          <strong>{observations.length}</strong>
                          <span>findings</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCompact(false)}
                          >
                            Edit
                          </Button>
                        </div>
                      ) : (
                        <form className="symptom-form" onSubmit={analyze}>
                          {
                            <>
                              <div className="symptom-search" ref={searchRoot}>
                                <label
                                  htmlFor="symptom-search"
                                  className="sr-only"
                                >
                                  Search symptoms
                                </label>
                                <Search size={19} className="search-icon" />
                                <Input
                                  id="symptom-search"
                                  disabled={ranking.isPending}
                                  role="combobox"
                                  aria-autocomplete="list"
                                  aria-expanded={
                                    searchOpen && search.trim().length >= 2
                                  }
                                  aria-controls="symptom-options"
                                  aria-activedescendant={
                                    highlight >= 0
                                      ? `symptom-option-${highlight}`
                                      : undefined
                                  }
                                  autoComplete="off"
                                  placeholder="Search symptoms, e.g. fever, joint pain, fatigue..."
                                  value={search}
                                  onFocus={() => setSearchOpen(true)}
                                  onChange={(e) => {
                                    setSearch(e.target.value);
                                    setSearchOpen(true);
                                    setHighlight(-1);
                                  }}
                                  onKeyDown={(e) => {
                                    const options = searchResults.data || [];
                                    if (e.key === "Escape") {
                                      setSearchOpen(false);
                                      return;
                                    }
                                    if (
                                      !searchOpen ||
                                      !options.length ||
                                      search.trim().length < 2
                                    )
                                      return;
                                    if (e.key === "ArrowDown") {
                                      e.preventDefault();
                                      setHighlight(
                                        (i) => (i + 1) % options.length,
                                      );
                                    } else if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      setHighlight(
                                        (i) =>
                                          (i - 1 + options.length) %
                                          options.length,
                                      );
                                    } else if (e.key === "Enter") {
                                      e.preventDefault();
                                      add(
                                        options[highlight < 0 ? 0 : highlight],
                                      );
                                    }
                                  }}
                                />
                                {search && (
                                  <button
                                    type="button"
                                    aria-label="Clear search"
                                    disabled={ranking.isPending}
                                    className="clear-search"
                                    onClick={() => {
                                      setSearch("");
                                      setSearchOpen(false);
                                    }}
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                                {searchOpen && search.trim().length >= 2 && (
                                  <div
                                    className="symptom-options"
                                    id="symptom-options"
                                    role="listbox"
                                    aria-label="Symptom suggestions"
                                  >
                                    {searchResults.isFetching ||
                                    debounced !== search.trim() ? (
                                      <div className="search-state">
                                        <LoaderCircle
                                          size={16}
                                          className="spin"
                                        />
                                        Searching symptoms…
                                      </div>
                                    ) : searchResults.isError ? (
                                      <ErrorNotice
                                        message="Symptom search is unavailable."
                                        retry={() => searchResults.refetch()}
                                      />
                                    ) : searchResults.data?.length ? (
                                      searchResults.data.map((p, i) => {
                                        const friendly = friendlyLabel(
                                          p,
                                          search,
                                        );
                                        const selected = observations.some(
                                          (o) => o.id === p.id,
                                        );
                                        return (
                                          <button
                                            type="button"
                                            id={`symptom-option-${i}`}
                                            role="option"
                                            aria-selected={highlight === i}
                                            key={p.id}
                                            className={
                                              highlight === i
                                                ? "highlighted"
                                                : ""
                                            }
                                            onMouseDown={(e) =>
                                              e.preventDefault()
                                            }
                                            onMouseMove={() => setHighlight(i)}
                                            onClick={() => add(p)}
                                          >
                                            <div>
                                              <strong>{friendly}</strong>
                                              <small>
                                                {friendly !== p.label
                                                  ? `Official HPO term: ${p.label} · `
                                                  : ""}
                                                {p.id}
                                              </small>
                                            </div>
                                            {selected ? (
                                              <Check size={16} />
                                            ) : (
                                              <Plus size={16} />
                                            )}
                                          </button>
                                        );
                                      })
                                    ) : (
                                      <div className="search-state">
                                        No matching symptom found. Try another
                                        name or an HPO ID.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <p className="search-help">
                                Search everyday terms, medical synonyms, or HPO
                                identifiers.
                              </p>
                              <div className="selected-symptoms-heading">
                                <span>
                                  Selected symptoms <b>{fields.length}</b>
                                </span>
                                {fields.length > 0 && (
                                  <button
                                    type="button"
                                    disabled={ranking.isPending}
                                    onClick={() => {
                                      remove();
                                      form.clearErrors();
                                    }}
                                  >
                                    Clear all
                                  </button>
                                )}
                              </div>
                              {fields.length === 0 ? (
                                <div className="symptom-empty">
                                  <Plus size={17} />
                                  <span>Add a symptom to begin.</span>
                                </div>
                              ) : (
                                <div className="symptom-chips">
                                  {fields.map((p, i) => (
                                    <div
                                      className={`symptom-chip ${observations[i]?.state}`}
                                      key={p.formKey}
                                    >
                                      <i aria-hidden="true" />
                                      <div
                                        className="symptom-details"
                                        title={
                                          p.official_label &&
                                          p.official_label !== p.label
                                            ? `Official HPO term: ${p.official_label}`
                                            : p.id
                                        }
                                      >
                                        <strong>{p.label}</strong>
                                        <small>
                                          {p.official_label &&
                                          p.official_label !== p.label
                                            ? `${p.official_label} · `
                                            : ""}
                                          {p.id}
                                        </small>
                                      </div>
                                      <select
                                        aria-label={`State for ${p.label}`}
                                        disabled={ranking.isPending}
                                        {...form.register(
                                          `observations.${i}.state`,
                                        )}
                                      >
                                        {Object.entries(stateNames).map(
                                          ([state, label]) => (
                                            <option key={state} value={state}>
                                              {label}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                      <details className="observation-provenance"><summary>Observation provenance<ChevronDown size={14} aria-hidden="true" /></summary><label>Evidence source<select aria-label={`Evidence source for ${p.label}`} disabled={ranking.isPending} {...form.register(`observations.${i}.provenance.kind`)}>{Object.entries(provenanceKinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Evidence-source note<input aria-label={`Evidence note for ${p.label}`} maxLength={700} disabled={ranking.isPending} {...form.register(`observations.${i}.provenance.note`)}/></label><small>Source attribution is user-recorded and not independently verified.</small></details>
                                      <button
                                        type="button"
                                        aria-label={`Remove ${p.label}`}
                                        disabled={ranking.isPending}
                                        onClick={() => remove(i)}
                                      >
                                        <X size={14} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <ClinicalContextEditor value={clinicalContext} onChange={setClinicalContext} disabled={ranking.isPending}/>
                              <details className="followup-preferences">
                                <summary>
                                  Follow-up preferences
                                  <ChevronDown size={13} />
                                </summary>
                                <label>
                                  Question limit
                                  <input
                                    aria-label="Follow-up question limit"
                                    type="number"
                                    min={1}
                                    max={20}
                                    value={questionLimit}
                                    disabled={ranking.isPending}
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      if (
                                        Number.isInteger(n) &&
                                        n >= 1 &&
                                        n <= 20
                                      )
                                        setQuestionLimit(n);
                                    }}
                                  />
                                </label>
                                <p>
                                  This limit controls the workflow, not clinical
                                  certainty. Unclassified findings require
                                  clinician review.
                                </p>
                              </details>
                              <div className="observation-semantics">
                                <Info size={14} />
                                <p>
                                  Ranking uses present findings. Absent findings
                                  prevent repeat follow-ups; unknown findings
                                  remain unresolved.
                                </p>
                              </div>
                            </>
                          }

                          {formError && (
                            <div className="form-error" role="alert">
                              {formError}
                            </div>
                          )}
                          <Button
                            className="analyze-button"
                            type="submit"
                            disabled={ranking.isPending || !online}
                          >
                            {ranking.isPending ? (
                              <LoaderCircle size={17} className="spin" />
                            ) : (
                              <Sparkles size={17} />
                            )}{" "}
                            {ranking.isPending
                              ? "Analyzing symptoms…"
                              : "Analyze Symptoms"}
                            {!ranking.isPending && <ArrowRight size={16} />}
                          </Button>

                          <p className="research-control-note">
                            <ShieldCheck size={13} />
                            Experimental research. Rankings are not diagnoses or
                            probabilities.
                          </p>
                        </form>
                      )}
                    </Card>
                    {snapshots.length > 0 && !compact && (
                      <div className="session-timeline">
                        <div className="timeline-heading">
                          <span>
                            <Clock3 size={14} />
                            This analysis
                          </span>
                          <button onClick={() => navigate("history")}>
                            Full history
                            <ChevronRight size={12} />
                          </button>
                        </div>
                        {snapshots.map((s) => (
                          <button
                            key={s.id}
                            className={s.id === active ? "active" : ""}
                            onClick={() => restore(s)}
                            disabled={ranking.isPending}
                          >
                            <span>
                              {s.id === active ? <Check size={11} /> : s.id}
                            </span>
                            <div>
                              <strong>{s.label}</strong>
                              <small>
                                {s.observations.length} observations
                                {s.parentId ? ` · from step ${s.parentId}` : ""}
                              </small>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </aside>
                  <div
                    className="panel-resizer"
                    role="separator"
                    tabIndex={0}
                    aria-label="Resize observations panel"
                    aria-orientation="vertical"
                    aria-valuemin={330}
                    aria-valuemax={540}
                    aria-valuenow={panelWidth}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      resizing.current = true;
                      document.body.classList.add("resizing");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        setPanelWidth((w) => Math.max(330, w - 20));
                      }
                      if (e.key === "ArrowRight") {
                        e.preventDefault();
                        setPanelWidth((w) => Math.min(540, w + 20));
                      }
                    }}
                  >
                    <span />
                  </div>
                  <section
                    ref={resultsRef}
                    className="results-panel"
                    aria-live="polite"
                  >
                    {ranking.isError && (
                      <ErrorNotice
                        message={ranking.error.message}
                        retry={retry}
                      />
                    )}
                    <AnimatePresence mode="wait">
                      {ranking.isPending ? (
                        <motion.div
                          key="loading"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.12 }}
                          className="analysis-progress"
                        >
                          <span className="progress-icon">
                            <LoaderCircle size={23} className="spin" />
                          </span>
                          <h2>Analyzing observations</h2>
                          <Button
                            variant="outline"
                            className="finish-analysis"
                            onClick={finishAnalysis}
                            disabled={finishQueued}
                          >
                            {finishQueued
                              ? "Finishing after the current response..."
                              : "Finish Analysis"}
                          </Button>
                          <p>
                            Your observations have been submitted. Waiting for
                            the model response.
                          </p>
                          <div className="progress-step">
                            <CheckCircle2 size={15} />
                            Observations submitted
                          </div>
                          <div className="progress-step active">
                            <LoaderCircle size={15} className="spin" />
                            Matching against reference profiles
                          </div>
                          <div className="loading-cards">
                            {[0, 1, 2].map((i) => (
                              <Skeleton key={i} className="h-28 w-full" />
                            ))}
                          </div>
                        </motion.div>
                      ) : !current ? (
                        <motion.div
                          key="initial"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.12 }}
                          className="analysis-ready"
                        >
                          <span className="ready-icon">
                            <SlidersHorizontal size={22} />
                          </span>
                          <h2>Ready when you are</h2>
                          <p>
                            Select the patient’s observations on the left, then
                            analyze to explore matching conditions.
                          </p>
                          <div className="ready-steps">
                            <div className={presentCount > 0 ? "complete" : ""}>
                              <span>
                                {presentCount > 0 ? <Check size={12} /> : 1}
                              </span>
                              <p>
                                Add present observations
                                <small>
                                  {presentCount
                                    ? `${presentCount} present ${presentCount === 1 ? "finding" : "findings"} selected`
                                    : "At least one present finding is needed"}
                                </small>
                              </p>
                            </div>
                            <div>
                              <span>2</span>
                              <p>
                                Analyze symptoms
                                <small>Ranked conditions appear here</small>
                              </p>
                            </div>
                            <div>
                              <span>3</span>
                              <p>
                                Refine with a follow-up
                                <small>
                                  Explore one additional observation at a time
                                </small>
                              </p>
                            </div>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={`results-${current.id}`}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="results-heading">
                            <div>
                              <span className="section-kicker">
                                ANALYSIS {current.id}
                              </span>
                              <h2>{"Matching Conditions"}</h2>
                              <p>
                                Source profiles sharing features with selected
                                observations. This is not an estimate of which
                                condition a person has.
                              </p>
                            </div>
                            <div className="result-finish-controls">
                              <Button
                                className="finish-analysis"
                                onClick={finishAnalysis}
                              >
                                Finish Analysis
                                <CheckCircle2 size={15} />
                              </Button>
                              <span className="result-count">
                                {current.response.rankings.length} returned
                              </span>
                            </div>
                          </div>
                          {dirty && (
                            <div className="edited-notice">
                              <Info size={15} />
                              <span>
                                Your observations have changed. Analyze again to
                                apply edits; these results still describe step{" "}
                                {current.id}.
                              </span>
                            </div>
                          )}
                          {current.question && (
                            <div className="answer-confirmation">
                              <CheckCircle2 size={15} />
                              <span>
                                Recorded {current.question.label}:{" "}
                                <strong>
                                  {current.question.state === "unknown"
                                    ? "Not sure"
                                    : stateNames[current.question.state]}
                                </strong>
                              </span>
                            </div>
                          )}
                          <RankChanges
                            current={current}
                            previous={parent}
                            names={names} evidence={byId}
                          />
                          {nextQuestion &&
                          current.response.rankings.length > 0 ? (
                            <Card
                              className={`followup-card ${dirty ? "awaiting-edits" : ""}`}
                            >
                              <div className="followup-label">
                                <Lightbulb size={17} />
                                <span>Clinician Observation Review</span>
                                <strong className="question-progress">
                                  Question {sessionAnswers.length + 1} of{" "}
                                  {questionLimit}
                                </strong>
                              </div>
                              <div className="question-category">
                                {mode === "patient"
                                  ? "Patient-reported observation"
                                  : "Clinician-assessed finding - qualified review required"}
                              </div>
                              <p>
                                An additional observation may help distinguish
                                the leading conditions.
                              </p>
                              <h3>Is {questionLabel} present?</h3><Badge>{reviewCategory(nextQuestion.phenotype_id,questionLabel)}</Badge><p className="review-rationale">{reviewRationale(nextQuestion.phenotype_id,leading)}</p>
                              <div className="review-evidence-source"><label>Evidence source<select aria-label="Review evidence source" value={reviewProvenance} onChange={e=>setReviewProvenance(e.target.value as typeof reviewProvenance)}>{Object.entries(provenanceKinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Optional evidence-source note<input aria-label="Review evidence note" maxLength={700} value={evidenceNote} onChange={e=>setEvidenceNote(e.target.value)}/></label></div><p>Record only evidence supporting this exact HPO finding. This recommendation is not an instruction to order a test. Unknown / Not Assessed is never treated as absent.</p>

                              <div className="followup-source">
                                <span>{nextQuestion.phenotype_id}</span>
                                <span title="Expected information gain from the existing backend">
                                  Information gain{" "}
                                  {nextQuestion.expected_information_gain_nats.toFixed(
                                    4,
                                  )}{" "}
                                  nats
                                </span>
                              </div>
                              <div className="followup-actions">
                                <Button
                                  disabled={
                                    dirty || !online || ranking.isPending
                                  }
                                  onClick={() => answer("present")}
                                >
                                  <Check size={15} />
                                  {"Documented Present"}
                                </Button>
                                <Button
                                  variant="outline"
                                  disabled={
                                    dirty || !online || ranking.isPending
                                  }
                                  onClick={() => answer("absent")}
                                >
                                  <X size={15} />
                                  {"Documented Absent"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  disabled={
                                    dirty || !online || ranking.isPending
                                  }
                                  onClick={() => answer("unknown")}
                                >
                                  Unknown / Not Assessed
                                </Button>
                              </div>
                              <div className="followup-stop">
                                <span>Follow-up questions are optional.</span>
                                <Button
                                  className="finish-analysis"
                                  onClick={finishAnalysis}
                                >
                                  Finish Analysis
                                  <CheckCircle2 size={15} />
                                </Button>
                              </div>
                              <small>
                                {dirty
                                  ? "Analyze your edited observations before answering another follow-up."
                                  : "Optional observation for clinical review, not a request to order a test."}
                              </small>
                            </Card>
                          ) : (
                            current.response.rankings.length > 0 && (
                              <div className="followups-complete">
                                <CheckCircle2 size={16} />
                                No further unanswered observations were
                                returned. You can finish now or edit the
                                findings.
                              </div>
                            )
                          )}
                          {evidence.isError && (
                            <ErrorNotice
                              message="Reference evidence is unavailable. Model rankings below are unchanged."
                              retry={() => evidence.refetch()}
                            />
                          )}
                          <div className="conditions-list">
                            {current.response.rankings.length === 0 ? (
                              <div className="no-conditions">
                                <Search size={24} />
                                <h3>No matching conditions returned</h3>
                                <p>
                                  Your observations are kept. Review them or
                                  retry the analysis.
                                </p>
                              </div>
                            ) : (
                              current.response.rankings
                                .slice(0, showAll ? 20 : 5)
                                .map((r) => (
                                  <ConditionCard
                                    key={r.disease_id}
                                    ranking={r}
                                    disease={byId.get(r.disease_id)}
                                    observations={current.observations}
                                    onDetails={() => setDetailId(r.disease_id)}
                                    selected={compareIds.includes(r.disease_id)}
                                    onCompare={() =>
                                      setCompareIds((old) =>
                                        old.includes(r.disease_id)
                                          ? old.filter(
                                              (id) => id !== r.disease_id,
                                            )
                                          : old.length < 5
                                            ? [...old, r.disease_id]
                                            : old,
                                      )
                                    }
                                    pending={evidence.isPending}
                                  />
                                ))
                            )}
                          </div>
                          {current.response.rankings.length > 5 && (
                            <Button
                              className="show-more"
                              variant="outline"
                              onClick={() => setShowAll((v) => !v)}
                            >
                              {showAll
                                ? "Show top 5 conditions"
                                : `Show all ${current.response.rankings.length} conditions`}
                              <ChevronDown size={15} />
                            </Button>
                          )}
                          {current.response.rankings.length > 0 && (
                            <Comparison
                              diseases={compared}
                              observations={current.observations}
                            />
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </section>
                </div>
              </>
            )}
          </>
        }
      </main>
      <DiseaseDrawer
        id={detailId}
        disease={detailId ? byId.get(detailId) : undefined}
        observations={current?.observations || []}
        others={leading.filter((d) => d.id !== detailId)}
        onClose={() => setDetailId(null)}
      />
      <dialog
        className="new-analysis-dialog"
        ref={newDialog}
        aria-labelledby="new-analysis-title"
      >
        <span className="reset-icon">
          <FilePlus2 size={24} />
        </span>
        <h2 id="new-analysis-title">Start a new analysis?</h2>
        <p>
          This clears the observations and analysis history in this tab. Your
          current case cannot be restored afterward.
        </p>
        <div>
          <Button variant="outline" onClick={() => newDialog.current?.close()}>
            Keep current analysis
          </Button>
          <Button onClick={clearCase}>Start new analysis</Button>
        </div>
      </dialog>
    </MotionConfig>
  );
}
