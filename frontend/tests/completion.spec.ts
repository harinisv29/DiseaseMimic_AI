import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function add(page: Page, id: string) {
  await page
    .getByRole("combobox", { name: "Search symptoms", exact: true })
    .fill(id);
  await page.getByRole("option").filter({ hasText: id }).first().click();
}
async function start(page: Page, clinician = true) {
  await page.goto("/");
  await add(page, "HP:0000135");
  await add(page, "HP:0001249");
  if (clinician) {
    await page.locator(".followup-preferences>summary").click();
    await page
      .getByRole("combobox", { name: "Follow-up reporting mode" })
      .selectOption("clinician");
  }
  const done = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  const response = await done;
  return await response.json();
}

test("Finish is immediately available and reuses the actual response; PDF contains real findings, scores, evidence and timestamp", async ({
  page,
}, testInfo) => {
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/rank") && r.method() === "POST") posts++;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const actual = await start(page);
  await expect(
    page.getByRole("heading", { name: "Matching Conditions", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish Analysis", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await expect(
    page.locator(".summary-conditions .condition-card").first(),
  ).toContainText(actual.rankings[0].disease_id);
  await expect(
    page.locator(".summary-conditions .condition-score strong").first(),
  ).toHaveText(actual.rankings[0].score.toFixed(4));
  await expect(
    page.getByText("0 follow-up questions answered", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Not Sure", exact: true }),
  ).toHaveCount(0);
  const downloadButton = page.getByRole("button", {
    name: "Download PDF Report",
    exact: true,
  });
  await expect(downloadButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  const path = testInfo.outputPath("final-analysis.pdf");
  await download.saveAs(path);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,
  });
  const doc = await task.promise;
  let content = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const text = await (await doc.getPage(i)).getTextContent();
    content +=
      text.items.map((item) => ("str" in item ? item.str : "")).join(" ") + " ";
  }
  await task.destroy();
  expect(content).toContain("Analysis Complete");
  expect(content).toContain("HP:0000135");
  expect(content).toContain("HP:0001249");
  expect(content).toContain(actual.rankings[0].disease_id);
  expect(content).toContain(actual.rankings[0].score.toFixed(6));
  expect(content).toContain("Source provenance");
  expect(content).toContain("Rankings are not diagnoses or probabilities");
  expect(content).toContain("IST");
  expect(posts).toBe(1);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/final-summary-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Edit Observations", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Search symptoms", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".symptom-chip")).toHaveCount(2);
  expect(posts).toBe(1);
});

test("Finish analyzes edited observations once, then uses the latest response", async ({
  page,
}) => {
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/rank") && r.method() === "POST") posts++;
  });
  await start(page);
  await expect(
    page.getByRole("heading", { name: "Matching Conditions", exact: true }),
  ).toBeVisible();
  await add(page, "HP:0001250");
  const done = page.waitForResponse(
    (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Finish Analysis", exact: true })
    .first()
    .click();
  const response = await done;
  expect(response.request().postDataJSON().present).toContain("HP:0001250");
  const actual = await response.json();
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".summary-conditions .condition-card").first(),
  ).toContainText(actual.rankings[0].disease_id);
  expect(posts).toBe(2);
});

test("five answered questions finish automatically; Not Sure remains unknown and no duplicates or sixth question appear", async ({
  page,
}) => {
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/rank") && r.method() === "POST") posts++;
  });
  await start(page);
  const ids: string[] = [];
  let latest: any;
  for (let i = 0; i < 5; i++) {
    await expect(page.locator(".question-progress")).toHaveText(
      `Question ${i + 1} of 5`,
    );
    const id = await page.locator(".followup-source>span").first().innerText();
    expect(ids).not.toContain(id);
    ids.push(id);
    const done = page.waitForResponse(
      (r) => r.url().endsWith("/rank") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Not Sure", exact: true }).click();
    const response = await done;
    const payload = response.request().postDataJSON();
    expect(payload.unknown).toEqual(expect.arrayContaining(ids));
    expect(payload.absent).toEqual([]);
    latest = await response.json();
  }
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("5 follow-up questions answered", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".followup-card")).toHaveCount(0);
  await expect(
    page.locator(".summary-conditions .condition-card").first(),
  ).toContainText(latest.rankings[0].disease_id);
  expect(posts).toBe(6);
  await page.screenshot({
    path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/final-five-questions.png`,
    fullPage: true,
  });
});

test("configured question cap counts answered questions only", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  await page.locator(".followup-preferences>summary").click();
  await page
    .getByRole("combobox", { name: "Follow-up reporting mode" })
    .selectOption("clinician");
  await page
    .getByRole("spinbutton", { name: "Follow-up question limit" })
    .fill("1");
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(page.locator(".question-progress")).toHaveText(
    "Question 1 of 1",
  );
  await page.getByRole("button", { name: /No.*Absent/ }).click();
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1 follow-up questions answered", { exact: false }),
  ).toBeVisible();
});

test("patient mode separates unsuitable diagnoses into final clinical review instead of asking them", async ({
  page,
  request,
}) => {
  const terms = await (
    await request.get(
      "http://127.0.0.1:8000/dashboard/phenotypes?q=Meningitis&limit=10",
    )
  ).json();
  const meningitis = terms.find(
    (p: { label: string }) => p.label === "Meningitis",
  );
  expect(meningitis).toBeTruthy();
  await page.route("**/rank", async (route) => {
    const actual = await route.fetch();
    const body = await actual.json();
    body.next_observations = body.next_observations.length
      ? [{ ...body.next_observations[0], phenotype_id: meningitis.id }]
      : [];
    await route.fulfill({ response: actual, json: body });
  });
  await start(page, false);
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Yes.*Present/ })).toHaveCount(
    0,
  );
  await expect(
    page.locator(".review-groups .review-finding").first(),
  ).toContainText("Meningitis");
  await expect(
    page.getByText("0 follow-up questions answered", { exact: false }),
  ).toBeVisible();
});

test("no recommendations and nonpositive gain end gracefully without an invented cutoff", async ({
  page,
}) => {
  await page.route("**/rank", async (route) => {
    const actual = await route.fetch();
    const body = await actual.json();
    body.next_observations = [];
    await route.fulfill({ response: actual, json: body });
  });
  const actual = await start(page);
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".summary-conditions .condition-card").first(),
  ).toContainText(actual.rankings[0].disease_id);
  await page
    .getByRole("button", { name: "Start New Analysis", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start new analysis", exact: true })
    .click();
  await page.unroute("**/rank");
  await page.route("**/rank", async (route) => {
    const real = await route.fetch();
    const body = await real.json();
    body.next_observations = body.next_observations.map((r: any) => ({
      ...r,
      expected_information_gain_nats: 0,
    }));
    await route.fulfill({ response: real, json: body });
  });
  await add(page, "HP:0001250");
  await page
    .getByRole("button", { name: "Analyze Symptoms", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".summary-reason")).toContainText(
    "No validated positive numerical cutoff",
  );
});

test("Finish during an in-flight analysis waits for that response without another prediction", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "HP:0001250");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/rank") && r.method() === "POST") posts++;
  });
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
  await page
    .getByRole("button", { name: "Finish Analysis", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
});

test("final summary and actions fit mobile layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await expect(
    page.getByRole("heading", { name: "Matching Conditions", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish Analysis", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Analysis Complete", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Edit Observations", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${process.env.DISEASEMIMIC_TEST_OUTPUT || "test-results"}/final-summary-mobile.png`,
    fullPage: true,
  });
});
