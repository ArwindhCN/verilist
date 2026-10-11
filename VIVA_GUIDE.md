# VeriList: Viva Study Guide

This guide is written in simple English so you can learn it and explain it in your own words.
Read it once from top to bottom. Then use the "20 likely viva questions" at the end to test yourself.

---

## 1. The problem, in one paragraph

On shopping sites like Flipkart and Amazon, anyone can make a listing that says "Genuine Fastrack watch" and
write any specs they like. The same watch can also show different details on different sites. And the same
product can appear many times, which clutters the search results. A buyer cannot tell which listing is
telling the truth, because nobody with real authority checks it.

**Our solution:** the *brand* becomes the one source of truth, stored on a blockchain. The brand says what its
products are, what their details are, and which sellers are allowed to sell them. A marketplace can only create
a listing if the blockchain agrees. A buyer can check any listing at any time.

**Out of scope:** fake *physical* goods (QR codes, NFC tags, delivery scanning), payments and escrow. We only
stop fake and duplicate *online listings*.

---

## 2. Why a blockchain and not one company's database?

Think about who would run a normal database. If Flipkart ran it, Amazon would not trust it. If a brand ran it,
marketplaces would not trust it. There is no one party everyone trusts. A blockchain solves three problems:

1. **Many parties who do not trust each other.** Brands, marketplaces and the admin all use the same shared
   record. No single company can quietly change it.
2. **Public verification.** Anyone can read it and check a listing without asking permission. The Verify page
   needs no login and no wallet.
3. **Tamper-evident history.** Nothing is overwritten. Every change is a new version, and every change emits
   an event that is saved forever. You can always see who changed what and when.

Honest note: a blockchain does not make the *brand's claims* true. It only makes them public, permanent and
attributable to the brand's wallet. See "Honest limitations" below.

---

## 3. The people (roles)

| Role | Who | What they can do |
|---|---|---|
| **Admin** | The platform consortium. The wallet that deployed the contracts. | Verify and revoke brands. Register and switch on/off marketplaces. |
| **Brand** | A verified wallet, for example Fastrack | Register its products, add new versions of the details, switch products on/off, authorize and revoke sellers. |
| **Marketplace** | A registered wallet, for example Flipkart | Create listings (only when the blockchain agrees) and remove its own listings. |
| **Seller** | A wallet, for example RetailNet | Can be authorized by a brand. Can remove its own listings. |
| **Buyer / public** | Anyone | Verify any listing. Read everything. |

---

## 4. The three contracts

There are three Solidity files. All use `pragma solidity 0.8.24;`.

### 4.1 `Ownable.sol` (a small base contract)

This gives a contract one **owner** (our "admin"). We wrote it by hand instead of importing OpenZeppelin, so
every line can be explained. `ProductRegistry` and `ListingRegistry` both inherit it.

- `owner` is set to whoever deploys the contract.
- `onlyOwner` is a *modifier*: a check that runs before a function. If the caller is not the owner, it stops
  with `NotOwner(caller)`.
- `transferOwnership(newOwner)`: only the owner can call it. It rejects the zero address (that would lock the
  admin functions forever) and emits `OwnershipTransferred`.

### 4.2 `ProductRegistry.sol` (brands, products, versions, sellers)

This is the **source of truth**. It stores who the real brands are, their products, every version of each
product's details, and which sellers a brand authorizes.

Main data:
- `Brand { name, verified, verifiedAt, exists }`
- `Product { brand, sku, name, active, createdAt, exists }`
- `Version { details, detailsHash, timestamp }` (the details are a JSON text)
- A list of versions per product. Version number N is stored at position N-1, so the numbers start at **1**.
- `authorizedSeller[productId][seller]` is true or false.

Limits (in bytes): name 100, SKU 64, details 4096.

### 4.3 `ListingRegistry.sol` (marketplaces and listings)

This decides who may create a listing and answers "is this listing genuine?". It **reads** from
`ProductRegistry` but never changes it. The address of `ProductRegistry` is saved once at deployment as
`immutable`, so nobody can swap it later.

Main data:
- `Marketplace { name, active, exists }`
- `Listing { id, productId, seller, marketplace, externalRef, createdAt, active }`
- `externalRef` is the marketplace's own ID for the listing, like `FLIP-883021`.
- `nextListingId` starts at **1**, so ID 0 always means "no listing".

---

## 5. Every function: who, what, checks, emits

"Reverts with X" means the transaction stops and nothing is saved. We use **custom errors** (like `NotOwner`)
instead of text messages, because they are cheaper and clearer.

### 5.1 Ownable

| Function | Who | What it does | Checks | Emits |
|---|---|---|---|---|
| `constructor()` | the deployer | Makes the deployer the owner. | none | `OwnershipTransferred(0, deployer)` |
| `transferOwnership(newOwner)` | owner | Gives admin rights to another wallet. | caller is owner; `newOwner` is not the zero address | `OwnershipTransferred` |

### 5.2 ProductRegistry: admin functions

| Function | Who | What it does | Checks (errors) | Emits |
|---|---|---|---|---|
| `verifyBrand(brand, name)` | admin | Says "this wallet really is this brand". Can also re-verify a revoked brand (and update its name). | not zero address (`ZeroAddress`); name not empty / not too long (`EmptyName`, `NameTooLong`); not already verified (`BrandAlreadyVerified`) | `BrandVerified` |
| `revokeBrand(brand)` | admin | Removes the "verified" status. The brand's products stay but stop being valid. | must be verified now (`BrandNotVerified`) | `BrandRevoked` |

### 5.3 ProductRegistry: brand functions

Two modifiers protect these:
- `onlyVerifiedBrand`: the caller must be a verified brand.
- `onlyProductBrand(productId)`: the product must exist (`ProductNotFound`), the caller must be the brand that
  owns it (`NotProductBrand`), and that brand must still be verified (`BrandNotVerified`).

| Function | Who | What it does | Other checks (errors) | Emits |
|---|---|---|---|---|
| `registerProduct(sku, name, details)` | verified brand | Creates a product, active, with version 1. Returns the product ID. | sku, name, details not empty / not too long; not already registered (`ProductAlreadyExists`) | `ProductRegistered`, then `VersionAdded(…, 1, hash)` |
| `updateProductDetails(productId, newDetails)` | owning brand | Adds a **new version**. Old versions are never changed. | product must be active (`ProductInactive`); details valid size; hash must differ from the latest (`DetailsUnchanged`) | `VersionAdded` |
| `setProductActive(productId, active)` | owning brand | Switches the product on or off. | must change the state (`StatusUnchanged`) | `ProductStatusChanged` |
| `authorizeSeller(productId, seller)` | owning brand | Allows a seller to sell this product. A brand may authorize itself (official store). | not zero address; not already authorized (`SellerAlreadyAuthorized`) | `SellerAuthorized` |
| `revokeSeller(productId, seller)` | owning brand | Stops a seller from selling this product. | must be authorized now (`SellerNotAuthorized`) | `SellerRevoked` |

### 5.4 ProductRegistry: read-only views (free to call)

| Function | What it returns |
|---|---|
| `computeProductId(brand, sku)` | The product ID: `keccak256(abi.encode(brand, sku))`. |
| `getBrand(brand)` | The brand record (empty if unknown). |
| `getBrandCount()`, `getBrands(offset, limit)` | How many brands, and a page of brand addresses. |
| `getProduct(productId)` | The product record. Reverts `ProductNotFound` if missing. |
| `getBrandProducts(brand, offset, limit)` | A page of that brand's product IDs. |
| `getVersionCount(productId)` | Number of versions. |
| `getVersion(productId, n)` | Version number `n` (starts at 1). Reverts `VersionNotFound` for 0 or too high. |
| `getLatestVersion(productId)` | The newest version. This is what every marketplace shows. |
| `isAuthorizedSeller(productId, seller)` | true / false. |
| `getAuthorizedSellers(productId)` | Only sellers authorized *right now* (revoked ones are left out). |
| `productStatus(productId)` | `NOT_FOUND`, `BRAND_NOT_VERIFIED`, `INACTIVE` or `VALID`, checked in that order. |

**Pagination rule:** if `offset` is at or past the end of a list, the view returns an empty list. It never
reverts. This keeps a long list from ever blocking a page.

### 5.5 ListingRegistry: admin functions

| Function | Who | What it does | Checks (errors) | Emits |
|---|---|---|---|---|
| `constructor(productRegistry)` | the deployer | Connects to the `ProductRegistry`. | not zero address | `OwnershipTransferred` |
| `registerMarketplace(marketplace, name)` | admin | Registers a wallet as a real marketplace (starts active). | not zero; name valid; not already registered (`MarketplaceAlreadyRegistered`) | `MarketplaceRegistered` |
| `setMarketplaceActive(marketplace, active)` | admin | Switches a marketplace on or off. | must exist (`MarketplaceNotRegistered`); must change state (`StatusUnchanged`) | `MarketplaceStatusChanged` |

### 5.6 ListingRegistry: marketplace functions

| Function | Who | What it does | Checks | Emits |
|---|---|---|---|---|
| `createListing(productId, seller, externalRef)` | registered, active marketplace | Creates a listing and returns its ID. | See the ordered list below. | `ListingCreated` |
| `removeListing(listingId)` | the listing's marketplace **or** its seller | Removes the listing. Frees the "duplicate" key so it can be listed again later. | exists (`ListingNotFound`); caller is a party (`NotListingParty`); still active (`ListingNotActive`) | `ListingRemoved` |

`createListing` first uses the `onlyActiveMarketplace` modifier (`MarketplaceNotRegistered`, then
`MarketplaceNotActive`). Then it checks, **in this exact order**, each with its own error:

1. the product exists (`ProductNotFound`)
2. the product's brand is verified (`BrandNotVerified`)
3. the product is active (`ProductInactive`)
4. the seller is authorized (`SellerNotAuthorized`)
5. there is no active duplicate (`DuplicateListing(existingListingId)`)
6. the reference is not empty and not too long (`EmptyExternalRef`, `ExternalRefTooLong`)
7. the reference was not used before by this marketplace (`ExternalRefAlreadyUsed`)

### 5.7 ListingRegistry: read-only views

| Function | What it returns |
|---|---|
| `checkListingEligibility(productId, seller, marketplace)` | "Could this listing be created right now?" Returns `GENUINE` or the reason. Uses the same order of checks as `createListing`. The frontend calls it **before** you send a transaction. |
| `verifyListing(listingId)` | The **live** verdict for a listing. See section 9. |
| `getListing(listingId)` | The stored listing. Reverts `ListingNotFound`. |
| `getListingWithDetails(listingId)` | The listing, the product's **latest** version, and the live status, in one call. |
| `getMarketplace`, `getMarketplaceCount`, `getMarketplaces(offset, limit)` | Marketplace info and a page of marketplace addresses. |
| `getMarketplaceListings(marketplace, offset, limit)`, `getProductListings(productId, offset, limit)` | A page of listing IDs. |
| `getListingCount()` | How many listings were ever created. |
| `computeListingKey(productId, seller, marketplace)` | The duplicate-blocking key (see section 8). |

The status values are: `GENUINE`, `LISTING_NOT_FOUND`, `LISTING_REMOVED`, `MARKETPLACE_INACTIVE`,
`PRODUCT_NOT_FOUND`, `BRAND_NOT_VERIFIED`, `PRODUCT_INACTIVE`, `SELLER_NOT_AUTHORIZED`, `DUPLICATE_LISTING`.
(`DUPLICATE_LISTING` only ever comes from `checkListingEligibility`.)

---

## 6. Why the product ID is `hash(brand, sku)`

```
productId = keccak256(abi.encode(brandAddress, sku))
```

- **Nobody can register a product under another brand's identity.** The brand's wallet address is *inside* the
  ID. When Titan registers SKU `ABC`, the ID is different from when Fastrack registers `ABC`. Titan cannot
  produce Fastrack's ID, because that needs Fastrack's address as the sender.
- **Brands can use their own simple codes** (SKUs) without worrying about clashes with other brands.
- **The same SKU twice by the same brand is rejected** (`ProductAlreadyExists`), because the ID would be the same.
- The ID is **predictable**: anyone can compute it from a brand address and a SKU (`computeProductId`).

---

## 7. Why versions are appended and never overwritten

When a brand changes the details, we **add a new version** at the end of the list. We never edit or delete the
old ones.

- **History cannot be rewritten.** If a brand secretly changed specs after selling units, the old version still
  proves what was promised at that time.
- **Everyone sees the same latest version.** Marketplaces do not store details. They always read the newest
  version from the registry, so Flipkart and Amazon can never disagree.
- **Each version stores** the details text, its `keccak256` hash, and the time it was saved.
- **No-op updates are blocked.** If the new hash equals the latest hash, the call reverts with
  `DetailsUnchanged`. So every version number means a real change. (Going back to *older* text is allowed,
  because only the *latest* version is compared.)

---

## 8. How duplicates are blocked: the listing key

```
listingKey = keccak256(abi.encode(productId, seller, marketplace))
activeListingByKey[listingKey] = listingId   (or 0 if none)
```

- When a listing is created, we save its ID under its key.
- Before creating another, we look the key up. If it is not 0, there is already an active listing for the same
  product, same seller, same marketplace. We revert with `DuplicateListing(existingListingId)`.
- When a listing is removed, we **clear** the key. So re-listing becomes possible again.
- The same seller can list the same product on a **different** marketplace, because the marketplace is part of
  the key. A **different seller** on the same marketplace also works.
- This is a single storage lookup. There is **no loop**, so it costs the same however many listings exist.

The marketplace's own listing reference (`externalRef`) must also be new for that marketplace, and it stays
"used" even after removal. So a re-listing needs a fresh reference.

---

## 9. How "live validity" works

A listing does **not** store "I am genuine". Genuineness is calculated **every time** you ask:

`verifyListing(listingId)` checks, in this order, and returns the first problem it finds:

1. Does the listing exist? (`LISTING_NOT_FOUND`)
2. Was it removed? (`LISTING_REMOVED`)
3. Is the marketplace active? (`MARKETPLACE_INACTIVE`)
4. Does the product exist? (`PRODUCT_NOT_FOUND`)
5. Is the brand verified? (`BRAND_NOT_VERIFIED`)
6. Is the product active? (`PRODUCT_INACTIVE`)
7. Is the seller authorized? (`SELLER_NOT_AUTHORIZED`)
8. Otherwise `GENUINE`.

Because nothing is cached, the answer changes **the moment** the brand or admin changes something, with no
need to touch the listing. If the brand revokes a seller, every listing of that seller flips to "not genuine".
If the brand authorizes the seller again, they flip back to "genuine". We proved this in tests (rule R10) and
in the demo: a Verify page left open in a second browser tab changes by itself.

---

## 10. What hashing gives us

A hash (here `keccak256`) is a fixed-size fingerprint of some data.
- The same text always gives the same hash. Change one character and the hash is completely different.
- You cannot recover the text from the hash.

We store the hash next to each version's text. The Verify page then does an **integrity check in the browser**:
it hashes the details it received, and compares with the hash stored on chain. If someone (for example a bad
website) showed different details than the brand registered, the hashes would not match.

We also use hashes for the product ID and the listing key (section 6 and 8).

---

## 11. Why details are on-chain here, and IPFS in real life

Storing text on a blockchain is expensive, because every node keeps it forever. In a real system you would
store the big details file on **IPFS** (a decentralized file network) and put only the file's hash (its IPFS
address) on the chain. The hash still proves nothing was changed.

We store the JSON text directly (max 4096 bytes) because:
- it keeps the project simple and easy to demo,
- the whole verification flow is visible in one place,
- on a local test chain, the cost does not matter.

---

## 12. Security choices

- **Access control with modifiers.** `onlyOwner`, `onlyVerifiedBrand`, `onlyProductBrand`, and
  `onlyActiveMarketplace` guard every state-changing function. A revoked brand loses control until it is verified again.
- **Custom errors** instead of text. Cheaper, and each failure has a clear name. The website turns each of
  them into a friendly sentence (a test checks that *every* error has one).
- **No payable functions, no `receive`, no `fallback`.** The contracts can never hold money, and sending ETH
  to them reverts. (Tested.)
- **Input limits.** Zero addresses, empty strings and over-long strings are rejected. Lengths are in bytes.
- **No loops in anything that writes.** Every write is a fixed number of steps, so nobody can make a
  transaction too expensive to run. List-returning views use `offset`/`limit`.
- **No `tx.origin`.** We only use `msg.sender`.
- **Timestamps are only recorded**, never used in decisions, so miners cannot influence the logic.
- **Only external calls are view calls** from `ListingRegistry` to `ProductRegistry`, so there is no reentrancy risk.
- **`immutable` registry address**, so it cannot be swapped after deployment.
- **Exact compiler version** (`0.8.24`), so the code always compiles the same way. Zero compiler warnings.
- **Static analysis with Slither.** One High finding was a false positive and was removed by a tiny code
  change. The rest are explained in `DECISIONS.md`.

---

## 13. Honest limitations

1. **Marketplaces must adopt it.** If Flipkart ignores the registry, nothing forces it to check. The system
   only helps where marketplaces agree to use it.
2. **We still trust the brand.** The chain proves *the brand said it*, not that the claims are true.
3. **The admin is centralized.** One wallet decides who is a brand or marketplace. Real use needs a multisig or a DAO.
4. **On-chain data is public.** Product details, authorized sellers and listings are visible to everyone.
5. **Physical counterfeits are out of scope.** A real fake sold in a real box with a genuine listing's name is not detected.
6. **Cost.** Every update costs gas on a public network. A local chain hides this.
7. **Unpaginated seller list.** `getAuthorizedSellers` loops over a product's seller history. Only the brand can grow it.

---

## 14. Future work

- **IPFS storage** for details, with only the hash on chain.
- **Multisig / DAO admin**, so no single wallet is the admin.
- **Unit-level QR claim:** a QR code on each physical unit, linked to the registry.
- **Escrow** and payments, so the money is released only for a genuine listing.
- **EIP-712 signed seller authorizations**, so a brand can sign an authorization off-chain and the seller
  submits it (saves the brand gas).
- **Event indexing with The Graph**, for fast searching and history across many listings.

---

## 15. How the pieces fit (the frontend, briefly)

- The website reads `deployment.json` (addresses and ABIs written by the deploy script).
- In **local demo mode** it talks to the Hardhat node directly and lets you switch accounts from a dropdown.
- In **MetaMask mode** (for Sepolia) it uses your wallet.
- The **Marketplace** tab asks `checkListingEligibility` as you type, so you see "Can list" or the exact reason
  *before* sending anything.
- Every failed transaction is decoded with `interface.parseError` into a friendly sentence.
- The **Activity feed** reads all events from the deployment block and keeps listening.

---

## 16. Twenty likely viva questions (with short answers)

**1. What problem does VeriList solve?**
Fake and duplicate listings on marketplaces. The brand's blockchain record decides which listings are genuine.

**2. Why a blockchain? Why not a normal database?**
Brands, marketplaces and the admin do not trust each other, so none of them should own the database. A chain is
shared, publicly checkable and keeps a tamper-evident history.

**3. Who are the actors?**
Admin, brand, marketplace, seller, and the public/buyer.

**4. How is a product identified?**
`keccak256(abi.encode(brandAddress, sku))`. The brand's address is inside the ID, so nobody can register a
product under another brand's identity.

**5. Can a marketplace change a product's details?**
No. A marketplace has no function for it. Only the owning brand can add versions. A listing always shows the latest version.

**6. What happens when a brand updates details?**
A new version is added. Old versions are never changed. Every marketplace now shows the new version, because
they all read it from the registry.

**7. Why is a no-change update rejected?**
If the new hash equals the latest hash, it reverts with `DetailsUnchanged`, so version numbers always mean a real change.

**8. How are duplicate listings stopped?**
A listing key `keccak256(productId, seller, marketplace)` points to the active listing. If it is not zero, a
new one is rejected. Removing a listing clears the key.

**9. Can the same seller list the same product on two marketplaces?**
Yes. The marketplace is part of the key, so they are different keys.

**10. What does "live validity" mean?**
`verifyListing` is recalculated on every call from the current state. If a brand revokes a seller, the listing
becomes "not genuine" at once, without editing it. When it is fixed, it becomes genuine again.

**11. What is the difference between `checkListingEligibility` and `verifyListing`?**
The first asks "could I create this listing now?" (before creating it, and it can report a duplicate). The
second asks "is this existing listing genuine now?".

**12. Why custom errors instead of `require` messages?**
They use less gas, they are typed (they can carry values like the existing listing ID), and the frontend can
decode them reliably.

**13. Why did you write `Ownable` yourself?**
It is tiny, and we can explain every line. It does one job: one owner and an `onlyOwner` check.

**14. How do you stop someone sending ETH to the contract?**
There is no `receive`, no `fallback` and no `payable` function, so any ETH transfer reverts. A test checks this.

**15. Are there any loops in functions that write data?**
No. Every write takes a fixed number of steps. Only read-only views loop, and the lists use `offset`/`limit`.

**16. What does the hash check on the Verify page prove?**
The browser hashes the details it received and compares with the hash stored on chain. A match means the text
is exactly what the brand registered.

**17. Why not store the details on IPFS?**
In production we would, and only keep the hash on chain, because chain storage is expensive. Here we store the
JSON directly (max 4096 bytes) to keep the demo simple.

**18. What are the main limitations?**
Marketplaces must choose to use it; we still trust the brand's claims; the admin is one centralized wallet;
chain data is public; physical counterfeits are not covered.

**19. What happens if the admin revokes a brand?**
All of that brand's products become invalid at once, and every listing of them shows "brand not verified". The
brand cannot register, update, switch, or change sellers until the admin verifies it again.

**20. How did you test it?**
Mocha/Chai tests with Hardhat for every rule R1 to R12 (the README maps each rule to named tests), an
integration test of the whole story, 100% statement/branch/function coverage, an end-to-end script, a Slither
scan, and a headless-browser smoke test of the website.
