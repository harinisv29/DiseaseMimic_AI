import { test, expect, type Page } from "@playwright/test";
async function add(page: Page, id: string) {
  await page
    .getByRole("combobox", { name: "Search symptoms or clinical findings" })
    .fill(id);
  await page.getByRole("option").filter({ hasText: id }).first().click();
}

test("loads real metadata, live CUDA status, and responsive empty state", async ({
  page,
  request,
}) => {
  const meta = await (
    await request.get("http://127.0.0.1:8000/dashboard/metadata")
  ).json();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "DiseaseMimic AI", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(meta.diseases.toLocaleString("en-US"), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Ready on CUDA", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Your candidate comparison starts here"),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", {
      name: "Search symptoms or clinical findings",
    }),
  ).toHaveAttribute(
    "placeholder",
    "Search symptoms, such as fever, muscle weakness, or an HPO ID\u2026",
  );
  expect(await page.locator("body").innerText()).not.toMatch(
    /\u00c2\u00b7|\u00e2\u20ac/,
  );
  await page.screenshot({
    path: "test-results/desktop-empty.png",
    fullPage: true,
  });
});

test("real HPO input, correct state payloads, evidence, comparison, recommendations and history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await add(page, "HP:0000135");
  await add(page, "HP:0001249");
  await add(page, "HP:0001250");
  const state = page.getByRole("combobox", {
    name: "State for Seizure",
    exact: true,
  });
  await state.selectOption("unknown");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  const result = await reply;
  expect(result.ok()).toBeTruthy();
  const input = result.request().postDataJSON();
  expect(input.unknown).toEqual(["HP:0001250"]);
  expect(input.present).not.toContain("HP:0001250");
  const data = await result.json();
  expect(data.device).toBe("cuda:0");
  await expect(
    page.getByText(data.rankings[0].disease_id, { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Details", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Matched present observations",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Why Do These Diseases Look Similar?" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("checkbox", { name: "Highlight shared" }).check();
  await page.getByRole("button", { name: "Show all 20" }).click();
  await expect(page.locator(".candidate-card")).toHaveCount(20);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  expect(
    await page.locator(".ranking-table tbody>tr").count(),
  ).toBeGreaterThanOrEqual(20);
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await page.screenshot({
    path: "test-results/desktop-results.png",
    fullPage: true,
  });
  const card = page.locator(".recommendation-card").first();
  await expect(card).toBeVisible();
  const id = await card.locator("small").first().innerText();
  const phenotypeId = id.split(" · ")[0];
  await card.getByRole("button", { name: "Absent", exact: true }).click();
  const updated = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page
    .locator(".recommendation-footer")
    .getByRole("button", { name: "Update Disease Ranking", exact: true })
    .click();
  const next = await updated;
  expect(next.request().postDataJSON().absent).toContain(phenotypeId);
  expect(next.request().postDataJSON().present).not.toContain(phenotypeId);
  await expect(
    page.getByRole("heading", { name: "How Did the Results Change?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Analysis history" }).locator("option"),
  ).toHaveCount(2);
  const newCard = page.locator(".recommendation-card").first();
  const nextId = (await newCard.locator("small").first().innerText()).split(
    " \u00b7 ",
  )[0];
  await newCard.getByRole("button", { name: "Present", exact: true }).click();
  const finalResponse = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page
    .locator(".recommendation-footer")
    .getByRole("button", { name: "Update Disease Ranking", exact: true })
    .click();
  const final = await finalResponse;
  expect(final.request().postDataJSON().present).toContain(nextId);
  const finalData = await final.json();
  await expect(page.locator(".candidate-card").first()).toContainText(
    finalData.rankings[0].disease_id,
  );
  await expect(
    page.getByRole("combobox", { name: "Analysis history" }).locator("option"),
  ).toHaveCount(3);
  await page
    .locator(".candidate-card")
    .first()
    .screenshot({ path: "test-results/candidate-card.png" });

  expect(errors).toEqual([]);
});

test("methodology loads measured artifact values and source provenance", async ({
  page,
  request,
}) => {
  const meta = await (
    await request.get("http://127.0.0.1:8000/dashboard/metadata")
  ).json();
  await page.goto("/#methodology");
  await expect(
    page.getByRole("heading", { name: "Research methodology" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: meta.evaluation.setting_A["0.5"].hybrid.mrr.toFixed(5),
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("HPO ontology", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "About", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Evidence with boundaries" }),
  ).toBeVisible();
});

test("validation and backend errors preserve input and recover with real analysis", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  await page
    .getByRole("combobox", { name: "State for Seizure", exact: true })
    .selectOption("absent");
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("present phenotype");
  await page
    .getByRole("combobox", { name: "State for Seizure", exact: true })
    .selectOption("present");
  await page.route("**/rank", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Backend temporarily unavailable" }),
    }),
  );
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Backend temporarily unavailable",
  );
  await expect(
    page.getByRole("combobox", { name: "State for Seizure", exact: true }),
  ).toHaveValue("present");
  await page.unroute("**/rank");
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(page.locator(".candidate-card").first()).toBeVisible();
});

test("mobile layout stays within viewport with actual results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Ready on CUDA", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mobile-empty.png",
    fullPage: true,
  });
  await add(page, "HP:0001250");
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(page.locator(".candidate-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mobile-results.png",
    fullPage: true,
  });
});

test("read-only adapters expose real references and reject unknown IDs", async ({
  request,
}) => {
  const search = await request.get(
    "http://127.0.0.1:8000/dashboard/phenotypes?q=HP%3A0001250",
  );
  expect(search.ok()).toBeTruthy();
  const terms = await search.json();
  expect(
    terms.some(
      (p: { id: string; label: string }) =>
        p.id === "HP:0001250" && p.label === "Seizure",
    ),
  ).toBeTruthy();
  const response = await request.post("http://127.0.0.1:8000/rank", {
    data: { present: ["HP:0001250"], absent: [], unknown: [], limit: 3 },
  });
  const rank = await response.json();
  const evidence = await request.get(
    "http://127.0.0.1:8000/dashboard/evidence?ids=" +
      encodeURIComponent(
        rank.rankings
          .map((r: { disease_id: string }) => r.disease_id)
          .join(","),
      ),
  );
  const records = await evidence.json();
  expect(records.map((r: { id: string }) => r.id)).toEqual(
    rank.rankings.map((r: { disease_id: string }) => r.disease_id),
  );
  expect(records[0].phenotypes.length).toBeGreaterThan(0);
  expect(records[0].sources.length).toBeGreaterThan(0);
  expect(
    (
      await request.get("http://127.0.0.1:8000/dashboard/evidence?ids=UNKNOWN")
    ).status(),
  ).toBe(422);
  const schema = await (
    await request.get("http://127.0.0.1:8000/openapi.json")
  ).json();
  expect(
    schema.paths["/dashboard/phenotypes"].get.responses["200"],
  ).toBeTruthy();
});

test("natural-language autocomplete, multiple symptoms, removal and clearing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Ready on CUDA", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Search symptoms or clinical findings" })
    .fill("muscle");
  await expect(page.getByRole("option").first()).toContainText(/HP:\d{7}/);
  await page.getByRole("option").first().click();
  await add(page, "HP:0001250");
  await expect(page.locator(".observation-chip")).toHaveCount(2);
  await page
    .locator(".observation-chip")
    .first()
    .getByRole("button", { name: /Remove/ })
    .click();
  await expect(page.locator(".observation-chip")).toHaveCount(1);
  const values = await page
    .getByRole("combobox", { name: "State for Seizure", exact: true })
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
  expect(values).toEqual(["present", "absent", "unknown"]);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.locator(".observation-chip")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Select at least one phenotype",
  );
  await page
    .getByRole("combobox", { name: "Search symptoms or clinical findings" })
    .fill("HP:9999999");
  await expect(page.getByText("No matching HPO terms found.")).toBeVisible();
});

test("missing ranking fields are rejected clearly and empty results are explicit", async ({
  page,
  request,
}) => {
  const real = await (
    await request.post("http://127.0.0.1:8000/rank", {
      data: { present: ["HP:0001250"], absent: [], unknown: [], limit: 3 },
    })
  ).json();
  await page.goto("/");
  await add(page, "HP:0001250");
  await page.route("**/rank", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rankings: [] }),
    }),
  );
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "incomplete or unexpected ranking fields",
  );
  await expect(page.locator(".observation-chip")).toHaveCount(1);
  await page.unroute("**/rank");
  await page.route("**/rank", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...real, rankings: [], next_observations: [] }),
    }),
  );
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching diseases returned" }),
  ).toBeVisible();
  await expect(page.locator(".candidate-card")).toHaveCount(0);
});

test("a timed-out request preserves manually entered symptoms", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  await expect(page.getByText("Ready on CUDA", { exact: true })).toBeVisible();
  await page.clock.install();
  await page.route("**/rank", () => {});
  const sent = page.waitForRequest("**/rank");
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await sent;
  await page.clock.fastForward(46000);
  await expect(page.getByRole("alert")).toContainText("timed out");
  await expect(page.locator(".observation-chip")).toHaveCount(1);
});

test("model-unavailable status prevents analysis and shows an actionable state", async ({
  page,
}) => {
  await page.route("**/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "loading",
        device: "cuda:0",
        method: "hybrid",
        gpu: "NVIDIA",
      }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "research model is not ready",
  );
  await expect(
    page.getByRole("button", { name: "Analyze Symptoms", exact: true }),
  ).toBeDisabled();
});

test("real backend rejects invalid HPO identifiers without fallback predictions", async ({
  request,
}) => {
  const response = await request.post("http://127.0.0.1:8000/rank", {
    data: { present: ["HP:9999999"], absent: [], unknown: [], limit: 5 },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).detail).toContain("Unsupported HPO IDs");
});
