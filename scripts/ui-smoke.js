// Headless browser smoke test of the frontend against a SEEDED local node.
//
// Needs three things running first (see README):
//   npm run node            (terminal 1)
//   npm run deploy:local && npm run seed:local   (terminal 2, on a fresh node)
//   npm run frontend:dev    (terminal 3)
// Then:   npm run ui-smoke
//
// It checks: the Verify view shows a genuine verdict with its check chain and hash check, a rejected
// listing is refused both by the pre-check and by the transaction, no console errors happen, and the page
// does not scroll sideways on a 375px phone screen. A second part drives MetaMask mode with a MOCK wallet
// (a fake window.ethereum that forwards to the local node), covering connect, account change and
// wrong-network handling. It never changes chain state (the rejected transaction is refused before
// anything is sent).
//
// Browser: by default Playwright's own Chromium (install once with `npx playwright-core install chromium`).
// To use a browser you already have, set BROWSER_PATH, for example on macOS:
//   BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run ui-smoke
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE_URL = process.env.FRONTEND_URL || "http://localhost:5173";


/**
 * A stand-in for MetaMask: an EIP-1193 `window.ethereum` that answers wallet-only methods itself and
 * forwards everything else to the local node (whose accounts are unlocked). It lets the smoke test
 * exercise the same BrowserProvider code path the real wallet uses. It is NOT a real MetaMask.
 */
function installMockWallet({ rpcUrl, accounts }) {
  let chainHex = "0x7a69";
  let shared = [];
  const listeners = {};
  const emit = (event, value) => (listeners[event] || []).forEach((fn) => fn(value));
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      if (method === "eth_chainId") return chainHex;
      if (method === "net_version") return String(parseInt(chainHex, 16));
      if (method === "eth_accounts") return shared;
      if (method === "eth_requestAccounts") {
        shared = [accounts.Fastrack];
        return shared;
      }
      if (method === "wallet_switchEthereumChain") {
        chainHex = params[0].chainId;
        emit("chainChanged", chainHex);
        return null;
      }
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params || [] }),
      });
      const json = await response.json();
      if (json.error) {
        const error = new Error(json.error.message);
        error.code = json.error.code;
        error.data = json.error.data;
        throw error;
      }
      return json.result;
    },
    on: (event, fn) => (listeners[event] = [...(listeners[event] || []), fn]),
    removeListener: (event, fn) => (listeners[event] = (listeners[event] || []).filter((f) => f !== fn)),
  };
  // Handles for the test to simulate things the user does inside the wallet.
  window.__wallet = {
    switchAccount: (address) => {
      shared = [address];
      emit("accountsChanged", shared);
    },
    setChain: (hex) => {
      chainHex = hex;
      emit("chainChanged", hex);
    },
  };
}

async function runWalletTests(browser, step, demoAccounts) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const accounts = Object.fromEntries(Object.entries(demoAccounts).map(([name, info]) => [name, info.address]));
  await context.addInitScript(installMockWallet, { rpcUrl: "http://127.0.0.1:8545", accounts });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));

  await step("MetaMask mode (mock wallet): switch to the wallet, public Verify still works without connecting", async () => {
    await page.goto(`${BASE_URL}/#/verify/3`);
    await page.getByRole("button", { name: "Use MetaMask instead" }).click();
    await page.getByRole("button", { name: "Connect wallet" }).first().waitFor();
    await page.getByTestId("verdict").waitFor();
    assert.match(await page.getByTestId("verdict").innerText(), /Genuine listing/);
    await page.goto(`${BASE_URL}/#/brand`);
    await page.getByText("No wallet connected").waitFor();
  });

  await step("MetaMask mode (mock wallet): connect shows the account's role and its products", async () => {
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page.locator("article.product").first().waitFor();
    assert.equal(await page.locator("article.product").count(), 2);
    assert.match(await page.locator(".account-switch").innerText(), /Fastrack/);
  });

  await step("MetaMask mode (mock wallet): accountsChanged switches the acting account", async () => {
    await page.evaluate((address) => window.__wallet.switchAccount(address), accounts.Flipkart);
    await page.goto(`${BASE_URL}/#/marketplace`);
    await page.getByRole("heading", { name: "Create a listing" }).waitFor();
    await page.locator("#listing-product").selectOption({ label: "Fastrack Reflex Pro — Fastrack" });
    await page.locator("#listing-seller").selectOption({ label: "Other address…" });
    await page.locator('input[aria-label="Seller: address"]').fill(accounts.FakeDeals);
    await page.locator("#listing-ref").fill("SMOKE-WALLET-1");
    await page.getByRole("button", { name: /Try anyway/ }).click();
    await page.locator(".tx-failed").waitFor();
    assert.match(await page.locator(".tx-failed").innerText(), /FakeDeals is not authorized by the brand/);
  });

  // An unseeded local account, so the app has no name for it yet.
  const UNNAMED = "0xdd2fd4581271e230360230f9337d5c0430bf44c0";

  await step("Naming in the app: a pasted seller address can be named, then is picked by name", async () => {
    await page.locator("#listing-seller").selectOption({ label: "Other address…" });
    await page.locator('input[aria-label="Seller: address"]').fill(UNNAMED);
    await page.getByLabel("Name this address").waitFor();
    assert.equal(await page.getByRole("button", { name: "Save name" }).isDisabled(), true, "no name typed yet");
    await page.getByLabel("Name this address").fill("PopupShop");
    await page.getByRole("button", { name: "Save name" }).click();
    await page.getByText("Saved name:").waitFor();
    // The address is now an ordinary choice in the dropdown and is selected.
    assert.equal(await page.locator('#listing-seller option:checked').innerText(), "PopupShop");
    assert.equal((await page.locator("#listing-seller").inputValue()).toLowerCase(), UNNAMED);
    assert.equal(await page.locator('input[aria-label="Seller: address"]').count(), 0, "the typed box is gone");
  });

  await step("Naming in the app: the name survives a reload and shows on the Brand tab; Forget removes it", async () => {
    await page.reload();
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page.goto(`${BASE_URL}/#/brand`);
    await page.locator("article.product").first().waitFor();
    const picker = page.locator('select[id^="auth-"]').first();
    await picker.selectOption({ label: "PopupShop" });
    await page.getByText("Saved name:").waitFor();
    await page.getByRole("button", { name: "Forget" }).click();
    // Forgotten: the name is gone from the dropdown, the address stays in the box, and it can be named again.
    assert.equal(await picker.locator("option", { hasText: "PopupShop" }).count(), 0);
    assert.equal((await page.locator('input[aria-label="Authorize a seller: address"]').first().inputValue()).toLowerCase(), UNNAMED);
    await page.getByLabel("Name this address").waitFor();
    // An address that already has a name (a demo account) is not offered a second one.
    await page.locator('input[aria-label="Authorize a seller: address"]').first().fill(accounts.FakeDeals);
    assert.equal(await page.getByLabel("Name this address").count(), 0);
    // Back to the marketplace account, as the next step expects (the reload reset the mock wallet to Fastrack).
    await page.evaluate((address) => window.__wallet.switchAccount(address), accounts.Flipkart);
    await page.goto(`${BASE_URL}/#/marketplace`);
    await page.getByRole("heading", { name: "Create a listing" }).waitFor();
  });

  await step("MetaMask mode (mock wallet): wrong network shows a switch button, and chainChanged recovers", async () => {
    await page.evaluate(() => window.__wallet.setChain("0x1"));
    await page.getByText("Your wallet is on the wrong network").waitFor();
    await page.getByRole("button", { name: "Switch network in wallet" }).click();
    await page.getByRole("tab", { name: "Marketplace" }).waitFor();
    await page.getByRole("heading", { name: "Create a listing" }).waitFor();
  });

  await step("MetaMask mode (mock wallet): no console errors", async () => {
    assert.deepEqual(errors, []);
  });

  await context.close();
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
    });
  } catch (error) {
    console.error("Could not start a browser.\n" + String(error.message).split("\n")[0]);
    console.error(
      "Install Playwright's Chromium with:  npx playwright-core install chromium\n" +
        "or point BROWSER_PATH at a Chrome/Chromium/Brave/Edge executable."
    );
    process.exitCode = 1;
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  // Collect anything that would show up in the browser console as an error.
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  const results = [];
  async function step(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  PASS  ${name}`);
    } catch (error) {
      results.push({ name, ok: false });
      console.log(`  FAIL  ${name}\n        ${String(error.message).split("\n").join("\n        ")}`);
    }
  }

  console.log(`VeriList UI smoke test against ${BASE_URL}\n`);

  await step("Verify view: listing #3 shows 'Genuine listing' with all five checks passing", async () => {
    await page.goto(`${BASE_URL}/#/verify/3`);
    const verdict = page.getByTestId("verdict");
    await verdict.waitFor();
    assert.match(await verdict.innerText(), /Genuine listing/);
    assert.equal(await verdict.getAttribute("data-status"), "0");
    assert.equal(await page.locator(".chain li").count(), 5);
    assert.equal(await page.locator('.chain li[data-pass="true"]').count(), 5);
  });

  await step("Verify view: hash integrity check passes and version history exists", async () => {
    assert.match(await page.getByTestId("hash-check").innerText(), /Integrity check passed/);
    assert.match(await page.locator(".version-chip").innerText(), /Version 2 of 2/);
    assert.match(await page.locator("details.history > summary").innerText(), /Version history \(2 versions\)/);
  });

  await step("Verify view: a listing number that does not exist is 'Not genuine'", async () => {
    await page.goto(`${BASE_URL}/#/verify/999`);
    const verdict = page.getByTestId("verdict");
    await page.waitForFunction(() => document.querySelector('[data-testid="verdict"]')?.dataset.status === "1");
    assert.match(await verdict.innerText(), /Not genuine/);
  });

  await step("Marketplace: as Flipkart, the pre-check and the transaction both reject FakeDeals", async () => {
    await page.goto(`${BASE_URL}/#/marketplace`);
    await page.locator("#account-select").selectOption({ label: "Flipkart (marketplace)" });
    await page.locator("#listing-product").selectOption({ label: "Fastrack Reflex Pro — Fastrack" });
    await page.locator("#listing-seller").selectOption({ label: "FakeDeals (unauthorized seller)" });
    await page.locator("#listing-ref").fill("SMOKE-FAKE-1");

    // Pre-check (a read-only call) already says no, with the exact reason.
    const precheck = page.getByTestId("precheck");
    await page.waitForFunction(() => document.querySelector('[data-testid="precheck"]')?.dataset.status === "7");
    assert.match(await precheck.innerText(), /Cannot list: the brand has not authorized this seller/);

    // The transaction is refused too, and the revert is shown as a friendly sentence.
    await page.getByRole("button", { name: /Try anyway/ }).click();
    const failure = page.locator(".tx-failed");
    await failure.waitFor();
    assert.match(
      await failure.innerText(),
      /FakeDeals is not authorized by the brand to sell Fastrack Reflex Pro\./
    );
  });

  await step("Role awareness: a non-marketplace account sees an explanation instead of a form", async () => {
    await page.locator("#account-select").selectOption({ label: "RetailNet (seller)" });
    await page.getByText("This account isn't a registered marketplace").waitFor();
    assert.equal(await page.locator("#listing-product").count(), 0);
  });

  await step("Brand, Admin and Marketplace views load with real data for their roles", async () => {
    await page.locator("#account-select").selectOption({ label: "Fastrack (brand)" });
    await page.goto(`${BASE_URL}/#/brand`);
    await page.locator("article.product").first().waitFor();
    assert.equal(await page.locator("article.product").count(), 2); // Reflex Pro and Chroma Analog
    await page.getByRole("heading", { name: "Register a product" }).waitFor();

    await page.locator("#account-select").selectOption({ label: "Admin" });
    await page.goto(`${BASE_URL}/#/admin`);
    await page.locator("table.table").first().waitFor();
    assert.equal(await page.locator("table.table").count(), 2); // brands and marketplaces
    assert.equal(await page.locator("table.table tbody tr").count(), 4); // 2 brands + 2 marketplaces

    await page.locator("#account-select").selectOption({ label: "Flipkart (marketplace)" });
    await page.goto(`${BASE_URL}/#/marketplace`);
    await page.getByRole("heading", { name: "Create a listing" }).waitFor();
    await page.locator("table.table tbody tr").first().waitFor();
  });

  await step("Role awareness: a non-brand account sees an explanation on the Brand tab", async () => {
    await page.locator("#account-select").selectOption({ label: "RetailNet (seller)" });
    await page.goto(`${BASE_URL}/#/brand`);
    await page.getByText("This account isn't a verified brand").waitFor();
  });

  await step("Activity feed shows human-readable events", async () => {
    const text = await page.locator(".feed-list").innerText();
    assert.match(text, /registered Fastrack Reflex Pro\./);
    assert.match(text, /created listing #1 of Fastrack Reflex Pro for RetailNet\./);
  });

  await step("Keyboard focus is visible on tabs, buttons and fields", async () => {
    await page.goto(`${BASE_URL}/#/verify/3`);
    await page.reload(); // start from the top of the page, so the first Tab lands on the skip link
    await page.getByTestId("verdict").waitFor();
    const seen = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return { tag: el.tagName, outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
      });
      if (focus.tag === "BODY") break; // focus left the page after its last element
      assert.notEqual(focus.outlineStyle, "none", `focused <${focus.tag}> has no outline`);
      assert.ok(focus.outlineWidth >= 2, `focused <${focus.tag}> outline is only ${focus.outlineWidth}px`);
      seen.push(focus.tag);
    }
    assert.ok(seen.length >= 8, `only ${seen.length} elements could be reached with the keyboard`);
    assert.ok(seen.includes("BUTTON") && seen.includes("SELECT") && seen.includes("INPUT"), `saw only ${seen}`);
  });

  await step("prefers-reduced-motion turns the animations off", async () => {
    const sealSeconds = () =>
      page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".seal")).animationDuration));
    // Wait for the verdict of THIS listing (its number appears in the panel), not a leftover one.
    const openListing = async (id) => {
      await page.goto(`${BASE_URL}/#/verify/${id}`);
      await page.getByTestId("verdict").locator("dd", { hasText: `#${id}` }).waitFor();
    };

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openListing(2);
    const reduced = await sealSeconds();
    assert.ok(reduced < 0.01, `seal animation still lasts ${reduced}s with reduced motion`);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openListing(3);
    const normal = await sealSeconds();
    assert.ok(normal > 0.1, `without the preference the seal should animate, got ${normal}s`);
  });

  await step("375px phone width: no sideways scrolling on any tab", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const hash of ["#/verify/3", "#/marketplace", "#/brand", "#/admin"]) {
      await page.goto(`${BASE_URL}/${hash}`);
      await page.waitForTimeout(1200);
      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      assert.ok(widths.scroll <= widths.inner, `${hash} scrolls sideways (${widths.scroll} > ${widths.inner})`);
    }
  });

  await step("No console errors in the whole run", async () => {
    assert.deepEqual(consoleErrors, []);
  });

  const demoFile = path.join(__dirname, "..", "frontend", "src", "contracts", "demo-accounts.json");
  if (fs.existsSync(demoFile)) {
    await runWalletTests(browser, step, JSON.parse(fs.readFileSync(demoFile, "utf8")));
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
