// Plays the README's "5-minute demo script" automatically in a headless browser, clicking the same things
// the README tells you to click, and checking the same results. It proves the written script and the real
// website still agree.
//
// WARNING: unlike `ui-smoke`, this CHANGES chain state (it updates a product, revokes and re-authorizes a
// seller, switches Amazon off and on). Run it once on a freshly seeded chain:
//   npm run node  (terminal 1)  ->  npm run deploy:local && npm run seed:local  (terminal 2)
//   npm run frontend:dev  (terminal 3)  ->  npm run ui-demo
// To run it again, restart the node and deploy + seed again.
//
// Browser: see the note at the top of scripts/ui-smoke.js (BROWSER_PATH or `npx playwright-core install chromium`).
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const BASE = process.env.FRONTEND_URL || "http://localhost:5173";
(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
    });
  } catch (error) {
    console.error("Could not start a browser: " + String(error.message).split("\n")[0]);
    console.error("Install one with `npx playwright-core install chromium`, or set BROWSER_PATH.");
    process.exit(1);
  }
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const log = (m) => console.log("  ok  " + m);
  const tab = (name) => page.getByRole("tab", { name }).click();
  const actAs = (label) => page.locator("#account-select").selectOption({ label });
  const verdictOf = async (id) => {
    await tab("Verify");
    await page.getByRole("button", { name: new RegExp(`^#${id}\\b`) }).click();
    await page.getByTestId("verdict").locator("dd", { hasText: `#${id}` }).waitFor();
    return page.getByTestId("verdict");
  };

  // ---- 1. Verify a genuine listing
  await page.goto(BASE);
  await page.getByRole("button", { name: /#1\s+Fastrack Reflex Pro/ }).click();
  let v = page.getByTestId("verdict");
  await v.locator("dd", { hasText: "#1" }).waitFor();
  assert.match(await v.innerText(), /Genuine listing/);
  assert.equal(await page.locator('.chain li[data-pass="true"]').count(), 5);
  for (const label of ["Listing active", "Marketplace active", "Brand verified", "Product active", "Seller authorized"])
    await page.locator(".chain li", { hasText: label }).first().waitFor();
  assert.match(await page.locator(".version-chip").innerText(), /Version 1 of 1/);
  assert.match(await page.getByTestId("hash-check").innerText(), /Integrity check passed/);
  log("1. genuine verdict, 5 checks pass, Version 1 of 1, integrity check passed");

  // ---- 2. As Flipkart, try to list for FakeDeals
  await actAs("Flipkart (marketplace)");
  await tab("Marketplace");
  await page.locator("#listing-product").selectOption({ label: "Fastrack Reflex Pro — Fastrack" });
  await page.locator("#listing-seller").selectOption({ label: "FakeDeals (unauthorized seller)" });
  await page.locator("#listing-ref").fill("FLIP-FAKE-1");
  await page.getByText("Cannot list: the brand has not authorized this seller for this product.").waitFor();
  await page.getByRole("button", { name: "Try anyway (will be rejected)" }).click();
  await page.getByText("FakeDeals is not authorized by the brand to sell Fastrack Reflex Pro.").first().waitFor();
  log("2. pre-check red + transaction rejected with the sentence from the README");

  // ---- 3. As Fastrack, update the details
  await actAs("Fastrack (brand)");
  await tab("Brand");
  const card = page.locator('article.product[aria-label="Fastrack Reflex Pro"]');
  await card.locator("summary", { hasText: "Update details" }).click();
  await card.getByLabel("MRP (₹)").fill("3495");
  await card.locator('input[aria-label="Spec 1 name"]').waitFor();
  const batteryRow = card.locator(".spec-row", { has: page.locator('input[value="battery"]') });
  await batteryRow.locator('input[aria-label$="value"]').fill("10 days");
  await card.getByRole("button", { name: "Publish new version" }).click();
  await card.getByText(/Confirmed in block \d+/).first().waitFor();
  await page.locator(".feed-list").getByText("Fastrack updated Fastrack Reflex Pro to version 2.").waitFor();
  log("3a. Publish new version confirmed; activity feed says 'updated … to version 2.'");
  for (const id of [1, 2]) {
    v = await verdictOf(id);
    assert.match(await v.innerText(), /Genuine listing/);
    assert.match(await page.locator(".version-chip").innerText(), /Version 2 of 2/);
    assert.match(await page.locator(".details").first().innerText(), /₹3,495/);
    assert.match(await page.locator(".details").first().innerText(), /10 days/);
  }
  log("3b. listings #1 (Flipkart) and #2 (Amazon) both show Version 2 of 2, ₹3,495, 10 days");

  // ---- 4. As Fastrack, revoke RetailNet
  await tab("Brand");
  await card.locator("summary", { hasText: "Authorized sellers" }).first().waitFor();
  await card.locator("li", { hasText: "RetailNet" }).getByRole("button", { name: "Revoke" }).click();
  await card.locator("li", { hasText: "RetailNet" }).waitFor({ state: "detached" }); // the row disappears once the revoke is mined
  await page.locator(".toast").getByText(/Last transaction confirmed in block \d+/).waitFor();
  v = await verdictOf(1);
  assert.match(await v.innerText(), /Not genuine/);
  assert.match(await v.innerText(), /The brand does not authorize this seller to sell this product/);
  assert.equal(await page.locator('.chain li[data-pass="false"]', { hasText: "Seller authorized" }).count(), 1);
  v = await verdictOf(2);
  assert.match(await v.innerText(), /Not genuine/);
  v = await verdictOf(3);
  assert.match(await v.innerText(), /Genuine listing/);
  log("4. revoke RetailNet -> #1 and #2 'Not genuine' (Seller authorized: Fail); #3 stays genuine");

  // ---- 5. Re-authorize RetailNet
  await tab("Brand");
  await card.locator(".authorize select").selectOption({ label: "RetailNet (seller)" });
  await card.getByRole("button", { name: "Authorize seller" }).click();
  await card.locator("li", { hasText: "RetailNet" }).waitFor();
  v = await verdictOf(1);
  assert.match(await v.innerText(), /Genuine listing/);
  log("5. re-authorize RetailNet -> #1 'Genuine listing' again");

  // ---- Optional: Admin deactivates Amazon
  await actAs("Admin");
  await tab("Admin");
  await page.locator("tr", { hasText: "Amazon" }).getByRole("button", { name: "Deactivate" }).click();
  await page.locator("tr", { hasText: "Amazon" }).getByRole("button", { name: "Activate" }).waitFor();
  for (const id of [2, 3]) {
    v = await verdictOf(id);
    assert.match(await v.innerText(), /The platform admin has switched this marketplace off/);
  }
  await tab("Admin");
  await page.locator("tr", { hasText: "Amazon" }).getByRole("button", { name: "Activate" }).click();
  await page.locator("tr", { hasText: "Amazon" }).getByRole("button", { name: "Deactivate" }).waitFor();
  v = await verdictOf(2);
  assert.match(await v.innerText(), /Genuine listing/);
  log("optional. Admin deactivates Amazon -> #2 and #3 'switched this marketplace off'; Activate restores");

  console.log("console errors:", JSON.stringify(errors));
  assert.deepEqual(errors, []);
  await browser.close();
  console.log("\nDEMO SCRIPT: every step works exactly as the README describes");
})().catch((e) => { console.error("\nDEMO FAILED:", e.message); process.exit(1); });
