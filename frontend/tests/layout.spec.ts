import { test, expect } from '@playwright/test';

for (const width of [1440, 768, 390, 320]) {
  test(`observation cards and disclosures fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const search = page.getByRole('combobox', { name: 'Search symptoms', exact: true });
    for (const term of ['Joint pain', 'HP:0001250', 'HP:0001249']) {
      await search.fill(term);
      await page.getByRole('listbox', { name: 'Symptom suggestions' }).getByRole('option').filter({ hasText: term }).first().click();
    }
    const cards = page.locator('.symptom-chip');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('Arthralgia');
    // Stress wrapping with long terminology and an unbroken identifier.
    await cards.nth(1).locator('strong').evaluate(el => {
      el.textContent = 'Progressive abnormality of musculoskeletal morphology with exceptionally long medical terminology';
    });
    await cards.nth(1).locator('.symptom-details small').evaluate(el => {
      el.textContent = 'LongMedicalSynonymWithoutSpaces'.repeat(4) + ' HP:0001250';
    });
    for (const card of await cards.all()) {
      await card.locator('summary').click();
      await card.getByRole('textbox').fill('Recorded observation for research review');
      await expect(card.getByRole('combobox').last()).toBeVisible();
    }
    const context = page.locator('.clinical-context');
    await context.locator('summary').click();
    await context.getByRole('textbox', { name: 'Onset', exact: true }).fill('Childhood');
    await expect(context.getByRole('textbox', { name: 'Onset', exact: true })).toHaveValue('Childhood');
    const issues = await page.evaluate(() => {
      const problems: string[] = [];
      if (document.documentElement.scrollWidth > innerWidth) problems.push('Page overflow');
      for (const card of document.querySelectorAll('.symptom-chip')) {
        const box = card.getBoundingClientRect();
        for (const el of card.querySelectorAll('strong, small, select, input, summary, button')) {
          const r = el.getBoundingClientRect();
          if (r.left < box.left || r.right > box.right + 1 || r.bottom > box.bottom + 1) problems.push(`Outside card: ${el.tagName}`);
        }
        const detail = card.querySelector('.symptom-details')!.getBoundingClientRect();
        const disclosure = card.querySelector('details')!.getBoundingClientRect();
        if (detail.bottom > disclosure.top) problems.push('Provenance overlaps details');
        const status = card.querySelector(':scope > select')!.getBoundingClientRect();
        if (status.left < detail.right && status.top < detail.bottom) problems.push('Status overlaps details');
      }
      return problems;
    });
    expect(issues).toEqual([]);
    await page.screenshot({ path: `test-results/layout-${width}.png`, fullPage: true });
    await cards.first().locator('summary').click();
    await expect(cards.first().getByRole('textbox')).not.toBeVisible();
    await cards.first().locator(':scope > select').selectOption('absent');
    await expect(cards.first()).toHaveClass(/absent/);
    await cards.first().getByRole('button', { name: 'Remove Joint pain' }).click();
    await expect(cards).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Analyze Symptoms', exact: true })).toBeEnabled();
  });
}


test('analysis still submits observations and provenance after disclosure edits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search symptoms', exact: true }).fill('Joint pain');
  await page.getByRole('listbox', { name: 'Symptom suggestions' }).getByRole('option').filter({ hasText: 'Joint pain' }).first().click();
  const card = page.locator('.symptom-chip');
  await card.locator('summary').click();
  await card.getByRole('combobox', { name: 'Evidence source for Joint pain', exact: true }).selectOption('documented-record');
  await card.getByRole('textbox').fill('Previously recorded finding');
  const response = page.waitForResponse(r => r.url().endsWith('/rank') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Analyze Symptoms', exact: true }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Matching Conditions', exact: true })).toBeVisible();
});
