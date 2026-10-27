import { test, expect, type Page } from "@playwright/test";
async function add(page: Page, id: string) {
  await page
    .getByRole("combobox", { name: "Search symptoms", exact: true })
    .fill(id);
  await page.getByRole("option").filter({ hasText: id }).first().click();
}
async function analyze(page: Page) {
  const preferences = page.locator(".followup-preferences");
  if (!(await preferences.evaluate((el) => (el as HTMLDetailsElement).open)))
    await preferences.locator("summary").click();
  const mode = page.getByRole("combobox", { name: "Follow-up reporting mode" });
  if ((await mode.inputValue()) !== "clinician")
    await mode.selectOption("clinician");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  const response = await reply;
  expect(response.ok()).toBeTruthy();
  await expect(
    page.getByRole("heading", { name: "Matching Conditions", exact: true }),
  ).toBeVisible();
  return {
    data: await response.json(),
    payload: response.request().postDataJSON(),
  };
}

test("compact app opens directly on symptom entry without research showcase content", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "What symptoms is the patient experiencing?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search symptoms", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByText("Backend connected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Matching Conditions", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Diseases in knowledge base", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("NVIDIA GeForce RTX 4070 SUPER", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Experimental research. Rankings are not diagnoses or probabilities.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/app-initial-desktop.png`,
    fullPage: true,
  });
});

test("reliable friendly synonym, keyboard navigation, multiple states and removal use real HPO data", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("combobox", {
    name: "Search symptoms",
    exact: true,
  });
  await input.fill("Joint pain");
  await expect(page.getByRole("option").first()).toContainText(
    "Official HPO term: Arthralgia",
  );
  await input.press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input.press("Enter");
  await expect(page.locator(".symptom-chip").first()).toContainText(
    "Joint pain",
  );
  await expect(page.locator(".symptom-chip").first()).toContainText(
    "HP:0002829",
  );
  await add(page, "HP:0001250");
  await add(page, "HP:0001249");
  await page
    .getByRole("combobox", { name: "State for Seizure", exact: true })
    .selectOption("unknown");
  await page
    .getByRole("combobox", {
      name: "State for Intellectual disability",
      exact: true,
    })
    .selectOption("absent");
  const result = await analyze(page);
  expect(result.payload.present).toEqual(["HP:0002829"]);
  expect(result.payload.unknown).toEqual(["HP:0001250"]);
  expect(result.payload.absent).toEqual(["HP:0001249"]);
  await page
    .getByRole("button", { name: "Remove Seizure", exact: true })
    .click();
  await expect(page.locator(".symptom-chip")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.locator(".symptom-chip")).toHaveCount(0);
  await input.fill("HP:9999999");
  await expect(
    page.getByText("No matching symptom found. Try another name or an HPO ID."),
  ).toBeVisible();
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("real matching conditions, drawer, automatic follow-ups, no repeated unknown question, history and branch restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await add(page, "HP:0000135");
  await add(page, "HP:0001249");
  const first = await analyze(page);
  await expect(page.locator(".condition-card")).toHaveCount(5);
  await expect(page.locator(".condition-card").first()).toContainText(
    first.data.rankings[0].disease_id,
  );
  await expect(page.locator(".condition-score strong").first()).toHaveText(
    first.data.rankings[0].score.toFixed(4),
  );
  await expect(
    page.locator(".condition-card").first().locator(".finding-pills"),
  ).toContainText("Hypogonadism");
  await page
    .getByRole("button", { name: "View Details", exact: true })
    .first()
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("Source provenance", { exact: false }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: "Potential distinguishing features" }),
  ).toBeVisible();
  await drawer.screenshot({ path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/condition-drawer.png` });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  const firstQuestion = first.data.next_observations[0].phenotype_id;
  const updated = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Yes.*Present/ }).click();
  const second = await updated;
  expect(second.request().postDataJSON().present).toContain(firstQuestion);
  const secondData = await second.json();
  await expect(page.locator(".condition-card").first()).toContainText(
    secondData.rankings[0].disease_id,
  );
  await expect(
    page.getByRole("heading", { name: "Matching Conditions", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".session-timeline>button")).toHaveCount(2);
  await expect(page.locator(".answer-confirmation")).toContainText("Present");
  const unknownQuestion = await page
    .locator(".followup-source>span")
    .first()
    .innerText();
  const thirdReply = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Not Sure", exact: true }).click();
  const third = await thirdReply;
  expect(third.request().postDataJSON().unknown).toContain(unknownQuestion);
  const thirdData = await third.json();
  await expect(
    page.getByRole("heading", { name: "Matching Conditions", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".condition-card").first()).toContainText(
    thirdData.rankings[0].disease_id,
  );
  await expect(page.locator(".answer-confirmation")).toContainText("Not sure");
  await expect(page.locator(".session-timeline>button")).toHaveCount(3);
  if (await page.locator(".followup-card").count())
    await expect(page.locator(".followup-source>span").first()).not.toHaveText(
      unknownQuestion,
    );
  await page.screenshot({
    path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/app-results-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Analysis history", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".history-entry")).toHaveCount(3);
  await page
    .locator(".history-entry")
    .first()
    .getByRole("button", { name: "Restore step" })
    .click();
  await expect(page.locator(".symptom-chip")).toHaveCount(2);
  await expect(page.locator(".session-timeline>button")).toHaveCount(3);
  await add(page, "HP:0001250");
  const branch = await analyze(page);
  expect(branch.payload.present).toContain("HP:0001250");
  await expect(page.locator(".session-timeline>button")).toHaveCount(4);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".history-entry")).toHaveCount(4);
  await expect(page.locator(".history-entry").last()).toContainText(
    "Continues from step 1",
  );
  expect(errors).toEqual([]);
});

test("new analysis confirms before clearing observations and history", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  await analyze(page);
  await page.getByRole("button", { name: "New Analysis", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start a new analysis?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep current analysis" }).click();
  await expect(page.locator(".condition-card")).toHaveCount(5);
  await page.getByRole("button", { name: "New Analysis", exact: true }).click();
  await page
    .getByRole("button", { name: "Start new analysis", exact: true })
    .click();
  await expect(page.locator(".symptom-chip")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Ready when you are" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No analyses yet" }),
  ).toBeVisible();
});

test("loading state prevents duplicate submissions and locks input until the real response", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => (unblock = resolve));
  await page.route("**/rank", async (route) => {
    await gate;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Analyzing observations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search symptoms", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New Analysis", exact: true }),
  ).toBeDisabled();
  unblock();
  await expect(page.locator(".condition-card")).toHaveCount(5);
});

test("validation and API errors retain findings and retry uses real inference", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  await page
    .getByRole("combobox", { name: "State for Seizure", exact: true })
    .selectOption("unknown");
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
  await expect(page.locator(".symptom-chip")).toHaveCount(1);
  await page.unroute("**/rank");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".condition-card")).toHaveCount(5);
});

test("incomplete fields are rejected, and a valid empty response has no fake conditions", async ({
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
    "incomplete or unexpected",
  );
  await expect(page.locator(".symptom-chip")).toHaveCount(1);
  await page.unroute("**/rank");
  await page.route("**/rank", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...real, rankings: [], next_observations: [] }),
    }),
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching conditions returned" }),
  ).toBeVisible();
  await expect(page.locator(".condition-card")).toHaveCount(0);
});

test("timeout keeps patient observations available for retry", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  await page.clock.install();
  await page.route("**/rank", () => {});
  const sent = page.waitForRequest("**/rank");
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await sent;
  await page.clock.fastForward(46000);
  await expect(page.getByRole("alert")).toContainText("timed out");
  await expect(page.locator(".symptom-chip")).toHaveCount(1);
});

test("model-unavailable state does not allow analysis", async ({ page }) => {
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
  await expect(page.getByRole("alert")).toContainText("model is not ready");
  await expect(
    page.getByRole("button", { name: "Analyze Symptoms", exact: true }),
  ).toBeDisabled();
});

test("mobile entry, real results, follow-up and details fit a single column", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "Search symptoms", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/app-mobile-initial.png`,
    fullPage: true,
  });
  await add(page, "HP:0001250");
  await analyze(page);
  await expect(page.locator(".condition-card")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .locator(".followup-card")
    .screenshot({ path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/mobile-followup.png` });
  await page
    .getByRole("button", { name: "View Details", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close condition details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close condition details" }).click();
  await page.screenshot({
    path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/app-mobile-results.png`,
    fullPage: true,
  });
});

test("resizable and collapsible observations retain selected findings", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  const separator = page.getByRole("separator", {
    name: "Resize observations panel",
  });
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 20));
  await page
    .getByRole("button", { name: "Collapse observations panel" })
    .click();
  await expect(
    page.getByRole("button", { name: "Expand observations panel" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand observations panel" }).click();
  await expect(page.locator(".symptom-chip")).toHaveCount(1);
});

test("comparison and graph remain optional and use real reference evidence", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  await analyze(page);
  await page.locator(".comparison-disclosure>summary").click();
  await expect(page.locator(".comparison-scroll table")).toBeVisible();
  await page.getByRole("button", { name: "Explore connections" }).click();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("checkbox", { name: "Highlight shared" }).check();
  await page.getByRole("button", { name: "Show all 20 conditions" }).click();
  await expect(page.locator(".condition-card")).toHaveCount(20);
});

test("About contains actual research results while the workspace stays task-focused", async ({
  page,
  request,
}) => {
  const meta = await (
    await request.get("http://127.0.0.1:8000/dashboard/metadata")
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: "About", exact: true }).click();
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
});

test("read-only synonym data and invalid HPO validation preserve the backend contract", async ({
  request,
}) => {
  const search = await (
    await request.get(
      "http://127.0.0.1:8000/dashboard/phenotypes?q=Joint%20pain&limit=1",
    )
  ).json();
  expect(search[0].id).toBe("HP:0002829");
  expect(search[0].label).toBe("Arthralgia");
  expect(search[0].synonyms).toContain("Joint pain");
  const invalid = await request.post("http://127.0.0.1:8000/rank", {
    data: { present: ["HP:9999999"], absent: [], unknown: [], limit: 3 },
  });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).detail).toContain("Unsupported HPO IDs");
});
