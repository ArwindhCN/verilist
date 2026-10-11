# DECISIONS.md

Every place where this project goes beyond, or differs from, `PROJECT_SPEC.md`, and why.
Nothing in the spec's rules R1 to R12 was weakened. No test was skipped, deleted or loosened to make it pass.
Where a test was wrong, it was a bug in the test itself (two cases, listed in section 9).

---

## 1. Project layout and tooling

| Topic | Decision | Reason |
|---|---|---|
| Project root | Built directly in the folder you opened (`bc project`), not in a nested `verilist/` folder. The package name is still `verilist`. | The spec's tree shows `verilist/` as the root. The folder you gave is that root. A nested folder would only add a level. |
| Hardhat | `hardhat@2.29.1`, `@nomicfoundation/hardhat-toolbox@5`. | Spec: Hardhat 2.x (not 3), toolbox ^5. 2.29.1 was the latest 2.x. |
| Node | Developed and tested on Node 24. | Spec says Node 20 or newer. Nothing in the project needs a newer feature than Node 20. |
| Solidity | `0.8.24`, exact pragma, optimizer on, 200 runs. | Spec. Hardhat targets `paris` by default for this version, which is fine for a local chain and Sepolia. |
| dotenv | Loaded with `quiet: true`. | dotenv 18 prints a banner on every command otherwise. |
| `npm audit` | Root reports 52 findings, **all in dev dependencies** pulled in by Hardhat's toolbox (19 low, 9 moderate, 24 high). `npm audit --omit=dev` reports 0. The frontend reports 0. | They are inside build and test tooling (not shipped, not run on a user's machine). Fixing them needs breaking upgrades of Hardhat itself, which the spec forbids (Hardhat 2.x). |
| Extra npm scripts | `ui-smoke` (`scripts/ui-smoke.js`) and `ui-demo` (`scripts/ui-demo.js`). | The spec asks for a Playwright smoke test if possible. Both need a running node and a seeded chain, so they cannot be part of `verify-all`. `ui-demo` replays the README's 5-minute demo script, so the written script and the real site cannot drift apart. It changes chain state, which the README and the script's header say. |
| Extra dev dependency | `playwright-core` (root). | For the same smoke test. It does **not** download a browser (see section 8). |
| `.claude/launch.json` | Created only so the preview tool could start `npm run frontend:dev`. It was removed at the end. | Tooling, not part of the project. |
| Generated JSON | `frontend/src/contracts/deployment.json` and `demo-accounts.json` are **not** git-ignored. | The spec's `.gitignore` list does not include them. The app and `frontend:build` work without them (see `src/lib/config.js`). |

---

## 2. Smart contracts: choices where the spec was silent

1. **ListingRegistry limits.** The spec only gives constants for `ProductRegistry`. I chose
   `MAX_NAME_LENGTH = 100` (marketplace name) and `MAX_EXTERNAL_REF_LENGTH = 64`, matching the SKU limit.
2. **Error names that the spec did not give.** `NotProductBrand(productId, caller)`,
   `MarketplaceNotRegistered(marketplace)` and `MarketplaceNotActive(marketplace)` (the spec says "must be a
   registered, active marketplace", which is two different failures, so two errors), `EmptyName`, `NameTooLong`,
   `EmptySku`, `SkuTooLong`, `EmptyDetails`, `DetailsTooLong`, `NotListingParty`, `ListingNotActive`,
   `ListingNotFound`. Errors that exist in both contracts (`ProductNotFound`, `BrandNotVerified`,
   `ProductInactive`, `SellerNotAuthorized`, `StatusUnchanged`, `EmptyName`, `NameTooLong`) have **identical
   signatures**, so the frontend can use one message per name.
3. **`BrandNotVerified(address brand)` in `ListingRegistry.createListing`.** The brand address is read with
   `registry.getProduct(productId).brand`, but only on the revert path, so successful calls pay nothing for it.
4. **Zero-address seller.** `createListing` has no separate `ZeroAddress` check for the seller. The zero address
   can never be authorized, so it fails with `SellerNotAuthorized`. A separate error would need its own
   `ListingStatus` value for the pre-check, and the spec fixes that enum. Tested.
5. **External references stay used forever.** `usedExternalRef` is never cleared, even when a listing is
   removed. Re-listing after removal is allowed, but needs a new reference. (A marketplace's own listing ID is
   normally unique forever.) Tested.
6. **`checkListingEligibility` also checks the marketplace.** It reports `MARKETPLACE_INACTIVE` first, for a
   marketplace that is inactive **or not registered**, because "could this listing be created?" is false in
   both cases. It cannot check the reference (it has no reference parameter).
7. **`getAuthorizedSellers(productId)` is not paginated.** The spec gives that exact signature, and also says
   list-returning views use `offset`/`limit`. I kept the signature the spec names. It loops over a product's
   seller history, which only the owning brand can grow, and it is a view (it costs a caller nothing). The
   other list views (`getBrands`, `getBrandProducts`, `getMarketplaces`, `getMarketplaceListings`,
   `getProductListings`) are paginated.
8. **`removeListing` has no "marketplace must be active" rule.** A switched-off marketplace can still clean up
   its listings, and a seller can remove its listing even after the brand revoked it. The spec only restricts
   *who* may remove (rule R11).
9. **`getLatestVersion` returns only the `Version` struct** (the spec's `Version` has no number field). The
   number comes from `getVersionCount`.
10. **`getBrands` returns addresses**, not full records. Use `getBrand(address)` for details.
11. **`getBrand` and `getMarketplace` return an empty record for unknown wallets** (they do not revert).
12. **The `_pageBounds` helper is written twice**, once in each registry. A shared library file would have added
    a file that is not in the spec's folder structure.
13. **`PRODUCT_NOT_FOUND` inside `verifyListing`** cannot happen in practice (products are never deleted), but it
    is kept because the spec lists it, and it is reachable through `checkListingEligibility`, so it is tested.
14. **Event order at registration:** `ProductRegistered`, then `VersionAdded(…, 1, hash)`, as the spec states.

---

## 3. Static analysis (Slither 0.11.6)

Installed with `pip install slither-analyzer` into a throw-away virtualenv (outside the project), then run with
`slither . --filter-paths node_modules`.

**First run: 9 results, including 1 High.**

| Finding | Severity | What I did |
|---|---|---|
| `uninitialized-state` on `ProductRegistry._versions` | High | **False positive.** The mapping was written through a local storage pointer (`Version[] storage v = _versions[id]; v.push(...)`), which the detector does not follow. I changed `_appendVersion` to call `_versions[productId].push(...)` directly. The finding disappeared, which confirms the diagnosis. Behaviour is unchanged and all tests still pass. |

**Final run: 8 results (0 High, 5 Medium, 3 Low). No code change; justified here.**

| Finding | Count | Why it is safe |
|---|---|---|
| `incorrect-equality` (Medium) | 5 | The flagged comparisons are `listing.id == 0` (a "no such listing" sentinel: IDs start at 1, so 0 can never be real) and `==` on the `ProductStatus` **enum**. The detector is aimed at strict equality on ETH balances or timestamps, which can be manipulated. Neither applies here. |
| `timestamp` (Low) | 3 | `block.timestamp` is **only written** into `createdAt`, `verifiedAt` and `Version.timestamp`. It is never compared and never used in a decision. Slither reports it because the same `Listing` struct, which holds `createdAt`, is also the subject of the `id == 0` comparisons above. |

---

## 4. Tests

- **Rule tags.** Test titles carry tags like `[R10]` so the README can map each rule to named tests.
- **Extra test file `test/ErrorMessages.test.js`** (not in the spec's list). It fails if any custom error in
  any contract's ABI has no friendly message in the frontend (and fails on stale entries), and it decodes
  real reverts with the real frontend decoder. It exists because the spec says "map **every** custom error".
- **One heuristic test.** `[R9] marketplaces have no function that changes product details` checks the
  *behaviour* (a marketplace calling `updateProductDetails` reverts `NotProductBrand`) and also scans
  `ListingRegistry`'s ABI for function names that look like detail-editing. The name scan is only a heuristic.
  The behavioural check is the real proof.
- **Coverage:** 100% statements, branches, functions and lines on all three contracts (target was 95/95/100).
- **`scripts/e2e-check.js`** has 20 steps. Its failure path was verified with a deliberately broken copy
  (exit code 1), not assumed.

---

## 5. Scripts

- **`verify-all.js`** runs the five required steps in order and stops at the first failure. If
  `frontend/node_modules` is missing it first runs `frontend:install`, so it also works on a fresh checkout.
  It runs each npm command as one string with `shell: true`, the cross-platform way to run `npm` (on Windows it
  is a `.cmd` file that cannot be spawned directly).
- **`seed.js`** refuses to run unless the network name is `localhost`/`hardhat` **and** the chain id is 31337.
  It also refuses to run twice on the same deployment, with instructions. (Its non-local refusal could not be
  exercised end to end: Hardhat stops a mismatched chain id itself, with `HH101`, before the script starts.)
- **`deploy.js`** does not write `deployment.json` on the temporary in-process `hardhat` network, because the
  file would point at contracts that disappear when the command ends.
- **Demo data is made up.** The seed uses invented products (Fastrack Reflex Pro, Fastrack Chroma Analog, Titan
  Edge Slim) and the 5-minute demo needs Reflex Pro to stay at version 1, so the seed's "update one product
  once" step updates Chroma Analog.

---

## 5b. Frontend: stack

- **Vite 8 + React 19** from the current official template (`create-vite`), JavaScript, plain CSS, ethers v6.
  The template's `oxlint` is kept (`npm --prefix frontend run lint`). It reports only warnings; the remaining
  ones are the "set state inside effect" style rule on data-loading effects and two deliberate
  `exhaustive-deps` omissions (each commented in the code). `lint` is not part of `verify-all`.
- **Chunk-size warning silenced.** ethers alone is about 500 kB minified, so the default warning limit would
  always print. `vite.config.js` raises it to 900 kB.
- **Fonts.** System font stack only (no web-font requests, so the demo works offline). One sans-serif family for
  the interface; monospace is used for hashes and addresses and, as a practical extension, also for listing
  references/IDs, shell commands and the raw JSON editor.
- **Dark mode is not implemented.** The spec does not ask for it.

---

## 6. Frontend: behaviour decisions

- **Routing in the address bar** (`#/verify/3`), so a verification can be shared as a link and the back button works.
- **"Try anyway (will be rejected)".** When the pre-check says a listing will fail, the Marketplace button
  stays enabled but changes to this label. The spec's demo step 2 requires the transaction to be sent and
  rejected, so it must be possible to send it. No gas is spent: the node refuses it during gas estimation.
- **Everything else is role-aware.** A tab whose role the current account lacks shows an explanation
  and the form is not shown. Buttons that need a role are disabled with the reason beside them.
- **The Verify view reads everything at one block number**, so the verdict and the five-step check chain
  cannot disagree with each other.
- **Signer created directly, not with `provider.getSigner(address)`.** In wallet mode, `getSigner(address)` checks
  `eth_accounts` and, if the account is missing (the user just switched accounts), calls
  `eth_requestAccounts`, which can open an unrequested wallet prompt. A fast account switch triggered exactly
  this in testing (it showed up as an "invalid account" error and a permanently disabled button, in roughly one test run
  out of every three to six). The app now builds `new JsonRpcSigner(provider, address)`, which makes no wallet calls. After the fix,
  12 of 12 repeated fast-switch runs passed.
- **"Last transaction" toast.** When a button disappears after its transaction confirms (for example the Revoke
  button of a revoked seller), its inline "Confirmed in block…" would vanish. The result is handed to a
  page-level toast so the confirmation is never lost.
- **Context split into its own file** (`context/chainState.js`). Having the provider component and the hook in
  one file broke hot-reload during development (a second, empty context was created).
- **Local demo mode can switch to MetaMask** ("Use MetaMask instead", only shown when a wallet is installed).
  The spec describes MetaMask mode for Sepolia; this just allows MetaMask against a local node too.
- **Account choice and mode are remembered** with `localStorage`, always wrapped in `try`/`catch`, never needed.
- **The activity feed polls** (every 1.5 s) instead of using `provider.on(filter)`: one loop does history and
  live updates, can chunk long block ranges for public RPC providers, and detects a node restart (the chain
  height goes backwards).
- **A chain restart is detected.** If the contracts disappear (node restarted), the app shows a setup screen with
  the commands to run, instead of failing silently.

---

## 7. Documentation

- `README.md` lists the rule-to-test table with exact test titles.
- `VIVA_GUIDE.md` is written in short, plain sentences for studying, with the 20 questions at the end.

---

## 8. Things that could not be done as the spec describes

| Item | What happened |
|---|---|
| **Playwright with its own browser** | No Chrome, Chromium or Edge was installed, and downloading a browser (about 170 MB) needs your approval, which I did not have. **Brave Browser** (Chromium-based) was installed, so the smoke test drives it through `playwright-core` with `BROWSER_PATH`. No browser was downloaded and no profile of yours was touched (Playwright uses a temporary profile). Anyone can instead run `npx playwright-core install chromium` and omit `BROWSER_PATH`. |
| **Real MetaMask** | Not available here. MetaMask mode was tested with a **mock `window.ethereum`** that forwards to the local node. That exercises the same `BrowserProvider` code (connect, `accountsChanged`, `chainChanged`, switch network, sending transactions), but it is not a real MetaMask. |
| **Sepolia** | `deploy:sepolia` was never run: it needs your RPC URL and a funded test key. The config only adds the network when both exist, and the README documents the steps. Untested against a real network. |
| **README commands, "copy-pasted"** | Verified on a pristine copy of the project (no `node_modules`, no build output, no generated JSON, no empty folders): `npm install`, `npm run frontend:install`, `npm run verify-all`, the 3-terminal flow, `npm run ui-smoke`, the `--grep` tip, the `HH100` and `HH108` messages, and the demo script run literally by `ui-demo`. The Windows-specific commands (`netstat`, `taskkill`, `Copy-Item`) were **not** run (this machine is macOS). |
| **"wrong-chain" setup screen** | Written, but not exercised (it needs a second local chain with a different id). The other setup screens (no deployment, node down, contracts missing after restart, no wallet, wrong wallet network) were all exercised. |

---

## 9. Bugs found by testing, and what was done

These are recorded because they were real problems, not spec deviations.

1. **Two test bugs (not contract bugs):** (a) `getAuthorizedSellers` returns a read-only ethers `Result`, which
   Chai's `members` cannot read, so the test now copies it to a plain array first; (b) the first draft of
   `ListingRegistry.test.js` had three no-op filler lines, which I removed before running.
2. **A real decoder bug, found by the new `ErrorMessages` test:** ethers' `parseError` already recognises
   `Error(string)` and `Panic(uint256)`, so my code hit its "custom error" branch for them and showed "no
   friendly message yet". Fixed in `frontend/src/lib/errors.js`.
3. **The signer race** described in section 6, found by the mock-wallet smoke test.
3b. **A stale-verdict bug, found by running the README demo literally.** The Verify view pins all its reads to
   one block number so the verdict and the check chain agree. It took that number from
   `provider.getBlockNumber()`, which ethers caches for 250 ms, so right after a change the page could be pinned
   to the **previous** block and show the old verdict (it said "Checked at block 19" when the chain was at 20).
   It self-corrected a second or two later (the activity feed triggers another reload), but it should never be
   wrong. Fixed with `latestBlock()` in `frontend/src/lib/chain.js`, which asks the node directly. After the
   fix the full demo script passed three times in a row from freshly reset chains.
3c. **A race in my own demo script** (not the app): a "wait for confirmation" selector matched a leftover
   "Confirmed" message from the previous step. The script now waits for the real signal (the revoked seller's
   row disappearing).
4. **A false verification in my own process:** my first check that `e2e-check.js` exits with code 1 on failure
   used a copy outside the project, which exited 1 only because `hardhat` could not be found. I noticed the
   output was empty, redid it properly, and saw the real `FAIL` and exit code 1.
