import { z } from "zod";

export const phenotypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  synonyms: z.array(z.string()).optional(),
  official_label: z.string().optional(),
});

export type Phenotype = z.infer<typeof phenotypeSchema>;

export const observationSchema = phenotypeSchema.extend({
  state: z.enum(["present", "absent", "unknown"]),
  provenance: z.object({kind:z.enum(['unspecified','patient-reported','clinician-confirmed','documented-record']),note:z.string().max(700),recordedAt:z.string()}).optional(),
});

export type Observation = z.infer<typeof observationSchema>;

export const formSchema = z.object({
  observations: z
    .array(observationSchema)
    .min(1, "Select at least one phenotype.")
    .refine(
      (a) => a.some((p) => p.state === "present"),
      "Add at least one present phenotype to analyze.",
    ),
});

export type FormValues = z.infer<typeof formSchema>;

const rankingSchema = z.object({
  disease_id: z.string(),
  score: z.number(),
  best_tied_rank: z.number(),
  worst_tied_rank: z.number(),
});

const recommendationSchema = z.object({
  phenotype_id: z.string(),
  expected_information_gain_nats: z.number(),
  predictive_present_probability: z.number(),
  reassessment: z.boolean(),
  availability: z.string(),
  note: z.string(),
});

export const rankSchema = z.object({
  method: z.string(),
  device: z.string(),
  rankings: z.array(rankingSchema),
  next_observations: z.array(recommendationSchema),
  observations: z.object({
    present: z.array(z.string()),
    absent: z.array(z.string()),
    unknown: z.array(z.string()),
  }),
  note: z.string(),
});

export type RankResponse = z.infer<typeof rankSchema>;

export type RankRequest = {
  present: string[];
  absent: string[];
  unknown: string[];
  available?: string[] | null;
  limit: number;
};

export const evidenceSchema = z.array(
  z.object({
    id: z.string(),
    label: z.string(),
    sources: z.array(z.string()),
    phenotypes: z.array(
      phenotypeSchema.extend({
        state: z.string(),
        frequencies: z.array(z.string()),
        sources: z.array(z.string()),
      }),
    ),
  }),
);

export type Evidence = z.infer<typeof evidenceSchema>[number];

export type Metrics = {
  top_1: number;
  top_3: number;
  top_5: number;
  mrr: number;
  mean_rank: number;
  queries: number;
};

export interface Metadata {
  diseases: number | null;
  associations: number | null;
  phenotypes: number | null;
  evaluation: {
    status: string;
    setting_A: Record<string, Record<string, Metrics>>;
  };
  training: {
    selected: { seed: number; best_epoch: number };
    total_training_seconds: number;
  };
  selection: { default_method: string };
  sources: {
    name: string;
    source_url: string;
    license: string;
    downloaded_at: string;
    source_version: unknown;
  }[];
}

export type Snapshot = {
  id: number;
  response: RankResponse;
  observations: Observation[];
};

export function toRequest(observations: Observation[]): RankRequest {
  return {
    present: observations.filter((p) => p.state === "present").map((p) => p.id),
    absent: observations.filter((p) => p.state === "absent").map((p) => p.id),
    unknown: observations.filter((p) => p.state === "unknown").map((p) => p.id),
    limit: 20,
  };
}

const BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

let sessionToken = "";
let sessionPromise: Promise<string> | null = null;
async function browserSession() {
  if (sessionToken) return sessionToken;
  if (!sessionPromise)
    sessionPromise = (async () => {
      const response = await fetch(BASE + "/dashboard/session", {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error("The local browser session could not be established.");
      const data = await response.json();
      sessionToken = data.token;
      return sessionToken;
    })().finally(() => {
      sessionPromise = null;
    });
  return sessionPromise;
}
export function clearBrowserSession() {
  sessionToken = "";
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const protectedRequest = init.method === "POST";
    const token = protectedRequest ? await browserSession() : "";
    let response = await fetch(BASE + path, {
      ...init,
      headers: {
        ...init.headers,
        ...(token ? { "X-Assessment-Session": token } : {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401 && protectedRequest) {
      sessionToken = "";
      const refreshed = await browserSession();
      response = await fetch(BASE + path, {
        ...init,
        headers: { ...init.headers, "X-Assessment-Session": refreshed },
        cache: "no-store",
        signal: controller.signal,
      });
    }
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : `Request failed (${response.status}). Check the selected observations.`,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "The request timed out. Your observations have been kept. Try again.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Cannot reach the research API. Check that the local backend is running.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  terms: (ids: string[]) =>
    request<
      {
        id: string;
        label: string;
        synonyms: string[];
        definitions: string[];
        source: string;
        source_url: string;
      }[]
    >("/dashboard/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  health: () =>
    request<{ status: string; device: string; method: string; gpu: string }>(
      "/health",
    ),

  metadata: () => request<Metadata>("/dashboard/metadata"),

  search: async (q: string) =>
    z
      .array(phenotypeSchema)
      .parse(
        await request("/dashboard/phenotypes/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
        }),
      ),

  rank: async (observations: Observation[]) => {
    const response = await request("/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toRequest(observations)),
    });
    const parsed = rankSchema.safeParse(response);
    if (!parsed.success)
      throw new Error(
        "The backend returned incomplete or unexpected ranking fields. Your selected symptoms have been kept. Please retry.",
      );
    return parsed.data;
  },

  evidence: async (ids: string[]) =>
    evidenceSchema.parse(
      await request(
        "/dashboard/evidence?ids=" + encodeURIComponent(ids.join(",")),
      ),
    ),
};

export const methodNames: Record<string, string> = {
  overlap: "Phenotype overlap",
  weighted: "Weighted matching",
  hgnn: "HGNN",
  ebm: "EBM",
  hgnn_ebm: "HGNN + EBM",
  hybrid: "Hybrid model",
};
