// Self-contained end-to-end check. Runs on Hardhat's in-process network, so no node needs to be running:
//   npm run e2e
// It deploys fresh contracts, plays the whole demo story, asserts every step, and prints PASS/FAIL per step.
// The process exits with code 1 if any step fails.
const assert = require("node:assert/strict");
const hre = require("hardhat");

const { ethers } = hre;

// Same order as the ListingStatus enum in ListingRegistry.sol.
const Status = {
  GENUINE: 0n,
  LISTING_NOT_FOUND: 1n,
  LISTING_REMOVED: 2n,
  MARKETPLACE_INACTIVE: 3n,
  PRODUCT_NOT_FOUND: 4n,
  BRAND_NOT_VERIFIED: 5n,
  PRODUCT_INACTIVE: 6n,
  SELLER_NOT_AUTHORIZED: 7n,
  DUPLICATE_LISTING: 8n,
};

const SKU = "FT-REFLEX-PRO";
const DETAILS_V1 = JSON.stringify({
  model: "Reflex Pro",
  category: "Smartwatch",
  specs: { battery: "7 days" },
  mrp: 2995,
  warranty: "1 year",
});
const DETAILS_V2 = JSON.stringify({
  model: "Reflex Pro",
  category: "Smartwatch",
  specs: { battery: "10 days" },
  mrp: 3495,
  warranty: "2 years",
});
const hashOf = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

/** Waits for a transaction to be mined. */
const mined = async (txPromise) => (await txPromise).wait();

/**
 * Asserts that a transaction (or call) reverts with a specific custom error.
 * `contract` is the contract whose ABI declares that error, so the revert data can be decoded.
 */
async function expectRevert(promise, contract, errorName) {
  let failure = null;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, `expected revert ${errorName}, but the call succeeded`);
  const data = failure.data ?? failure.error?.data ?? failure.info?.error?.data;
  const parsed = typeof data === "string" && data.length >= 10 ? contract.interface.parseError(data) : null;
  const actual = failure.revert?.name ?? parsed?.name ?? failure.shortMessage ?? failure.message;
  assert.equal(actual, errorName, `expected revert ${errorName}, got ${actual}`);
}

/** Asserts that a plain ETH transfer to a contract is rejected. */
async function expectEthRejected(signer, contract) {
  let failure = null;
  try {
    await signer.sendTransaction({ to: await contract.getAddress(), value: 1n });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, "expected the ETH transfer to revert");
}

async function main() {
  const [admin, fastrack, titan, flipkart, amazon, retailNet, quickShop, fakeDeals, stranger] =
    await ethers.getSigners();

  // Shared state between steps.
  let products;
  let listings;
  let productId;

  const results = [];
  let stepNumber = 0;
  async function step(name, fn) {
    stepNumber += 1;
    const label = `${String(stepNumber).padStart(2, " ")}. ${name}`;
    try {
      await fn();
      results.push({ label, ok: true });
      console.log(`  PASS  ${label}`);
    } catch (error) {
      results.push({ label, ok: false, error });
      console.log(`  FAIL  ${label}`);
      console.log(`        ${String(error.message).split("\n").join("\n        ")}`);
    }
  }

  console.log("VeriList end-to-end check (in-process Hardhat network)\n");

  await step("Deploy ProductRegistry and ListingRegistry", async () => {
    products = await (await ethers.getContractFactory("ProductRegistry")).deploy();
    listings = await (await ethers.getContractFactory("ListingRegistry")).deploy(await products.getAddress());
    assert.equal(await products.owner(), admin.address);
    assert.equal(await listings.owner(), admin.address);
    assert.equal(await listings.registry(), await products.getAddress());
  });

  await step("Admin verifies Fastrack and registers Flipkart and Amazon", async () => {
    await mined(products.connect(admin).verifyBrand(fastrack.address, "Fastrack"));
    await mined(listings.connect(admin).registerMarketplace(flipkart.address, "Flipkart"));
    await mined(listings.connect(admin).registerMarketplace(amazon.address, "Amazon"));
    assert.equal((await products.getBrand(fastrack.address)).verified, true);
    assert.equal((await listings.getMarketplace(flipkart.address)).active, true);
    assert.equal((await listings.getMarketplace(amazon.address)).active, true);
  });

  await step("R1: a non-admin cannot verify a brand or register a marketplace", async () => {
    await expectRevert(products.connect(stranger).verifyBrand(stranger.address, "Self"), products, "NotOwner");
    await expectRevert(listings.connect(stranger).registerMarketplace(stranger.address, "Self"), listings, "NotOwner");
  });

  await step("R2: Fastrack registers a watch; ID and version-1 hash are correct", async () => {
    productId = await products.computeProductId(fastrack.address, SKU);
    await mined(products.connect(fastrack).registerProduct(SKU, "Reflex Pro", DETAILS_V1));
    const expectedId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address", "string"], [fastrack.address, SKU])
    );
    assert.equal(productId, expectedId);
    const v1 = await products.getVersion(productId, 1);
    assert.equal(v1.details, DETAILS_V1);
    assert.equal(v1.detailsHash, hashOf(DETAILS_V1));
    assert.equal(await products.getVersionCount(productId), 1n);
  });

  await step("R2: an unverified wallet cannot register; the same SKU under another brand gets another ID", async () => {
    await expectRevert(
      products.connect(stranger).registerProduct(SKU, "Fake Reflex Pro", DETAILS_V1),
      products,
      "BrandNotVerified"
    );
    await mined(products.connect(admin).verifyBrand(titan.address, "Titan"));
    await mined(products.connect(titan).registerProduct(SKU, "Titan item", DETAILS_V1));
    const titanId = await products.computeProductId(titan.address, SKU);
    assert.notEqual(titanId, productId);
    assert.equal((await products.getProduct(titanId)).brand, titan.address);
  });

  await step("Fastrack authorizes RetailNet", async () => {
    await mined(products.connect(fastrack).authorizeSeller(productId, retailNet.address));
    assert.equal(await products.isAuthorizedSeller(productId, retailNet.address), true);
    assert.deepEqual([...(await products.getAuthorizedSellers(productId))], [retailNet.address]);
  });

  await step("Flipkart lists the watch via RetailNet and it verifies as GENUINE", async () => {
    assert.equal(
      await listings.checkListingEligibility(productId, retailNet.address, flipkart.address),
      Status.GENUINE
    );
    await mined(listings.connect(flipkart).createListing(productId, retailNet.address, "FLIP-883021"));
    assert.equal(await listings.verifyListing(1), Status.GENUINE);
    const listing = await listings.getListing(1);
    assert.equal(listing.marketplace, flipkart.address);
    assert.equal(listing.seller, retailNet.address);
    assert.equal(listing.externalRef, "FLIP-883021");
  });

  await step("R7: FakeDeals (unauthorized) is rejected by the pre-check and by the transaction", async () => {
    assert.equal(
      await listings.checkListingEligibility(productId, fakeDeals.address, flipkart.address),
      Status.SELLER_NOT_AUTHORIZED
    );
    await expectRevert(
      listings.connect(flipkart).createListing(productId, fakeDeals.address, "FLIP-FAKE-1"),
      listings,
      "SellerNotAuthorized"
    );
    assert.equal(await listings.getListingCount(), 1n);
  });

  await step("R8: a duplicate active listing is blocked, and the pre-check says DUPLICATE_LISTING", async () => {
    assert.equal(
      await listings.checkListingEligibility(productId, retailNet.address, flipkart.address),
      Status.DUPLICATE_LISTING
    );
    await expectRevert(
      listings.connect(flipkart).createListing(productId, retailNet.address, "FLIP-883022"),
      listings,
      "DuplicateListing"
    );
  });

  await step("R8: Amazon can list the same product and seller (different marketplace)", async () => {
    await mined(listings.connect(amazon).createListing(productId, retailNet.address, "AMZ-B0DEMO001"));
    assert.equal(await listings.verifyListing(2), Status.GENUINE);
  });

  await step("R6: a wallet that is not a marketplace cannot create listings", async () => {
    await expectRevert(
      listings.connect(stranger).createListing(productId, retailNet.address, "X-1"),
      listings,
      "MarketplaceNotRegistered"
    );
  });

  await step("R4/R5/R9: Fastrack updates the specs; both marketplaces see version 2; old version untouched", async () => {
    await expectRevert(
      products.connect(fastrack).updateProductDetails(productId, DETAILS_V1),
      products,
      "DetailsUnchanged"
    );
    await expectRevert(products.connect(flipkart).updateProductDetails(productId, DETAILS_V2), products, "NotProductBrand");

    await mined(products.connect(fastrack).updateProductDetails(productId, DETAILS_V2));
    assert.equal(await products.getVersionCount(productId), 2n);
    for (const listingId of [1, 2]) {
      const [, latest, status] = await listings.getListingWithDetails(listingId);
      assert.equal(latest.details, DETAILS_V2);
      assert.equal(latest.detailsHash, hashOf(DETAILS_V2));
      assert.equal(status, Status.GENUINE);
    }
    const v1 = await products.getVersion(productId, 1);
    assert.equal(v1.details, DETAILS_V1);
    assert.equal(v1.detailsHash, hashOf(DETAILS_V1));
  });

  await step("R10: revoking RetailNet flips both listings to SELLER_NOT_AUTHORIZED; re-authorizing flips them back", async () => {
    await mined(products.connect(fastrack).revokeSeller(productId, retailNet.address));
    assert.equal(await listings.verifyListing(1), Status.SELLER_NOT_AUTHORIZED);
    assert.equal(await listings.verifyListing(2), Status.SELLER_NOT_AUTHORIZED);
    await mined(products.connect(fastrack).authorizeSeller(productId, retailNet.address));
    assert.equal(await listings.verifyListing(1), Status.GENUINE);
    assert.equal(await listings.verifyListing(2), Status.GENUINE);
  });

  await step("R10: deactivating the product flips listings to PRODUCT_INACTIVE and blocks new ones; reactivating restores", async () => {
    await mined(products.connect(fastrack).setProductActive(productId, false));
    assert.equal(await listings.verifyListing(1), Status.PRODUCT_INACTIVE);
    await mined(products.connect(fastrack).authorizeSeller(productId, quickShop.address));
    await expectRevert(
      listings.connect(flipkart).createListing(productId, quickShop.address, "FLIP-QS-1"),
      listings,
      "ProductInactive"
    );
    await mined(products.connect(fastrack).setProductActive(productId, true));
    assert.equal(await listings.verifyListing(1), Status.GENUINE);
  });

  await step("R10/R3: revoking the brand flips listings to BRAND_NOT_VERIFIED and freezes the brand; re-verifying restores", async () => {
    await mined(products.connect(admin).revokeBrand(fastrack.address));
    assert.equal(await listings.verifyListing(1), Status.BRAND_NOT_VERIFIED);
    await expectRevert(
      products.connect(fastrack).updateProductDetails(productId, "{}"),
      products,
      "BrandNotVerified"
    );
    await expectRevert(
      listings.connect(flipkart).createListing(productId, quickShop.address, "FLIP-QS-1"),
      listings,
      "BrandNotVerified"
    );
    await mined(products.connect(admin).verifyBrand(fastrack.address, "Fastrack"));
    assert.equal(await listings.verifyListing(1), Status.GENUINE);
  });

  await step("R10: deactivating Amazon flips its listing to MARKETPLACE_INACTIVE; reactivating restores", async () => {
    await mined(listings.connect(admin).setMarketplaceActive(amazon.address, false));
    assert.equal(await listings.verifyListing(2), Status.MARKETPLACE_INACTIVE);
    assert.equal(await listings.verifyListing(1), Status.GENUINE); // Flipkart is unaffected
    await expectRevert(
      listings.connect(amazon).createListing(productId, quickShop.address, "AMZ-QS-1"),
      listings,
      "MarketplaceNotActive"
    );
    await mined(listings.connect(admin).setMarketplaceActive(amazon.address, true));
    assert.equal(await listings.verifyListing(2), Status.GENUINE);
  });

  await step("R11: a stranger cannot remove a listing; the seller can; re-listing is then allowed", async () => {
    await expectRevert(listings.connect(stranger).removeListing(2), listings, "NotListingParty");
    await mined(listings.connect(retailNet).removeListing(2));
    assert.equal(await listings.verifyListing(2), Status.LISTING_REMOVED);
    await expectRevert(listings.connect(amazon).removeListing(2), listings, "ListingNotActive");

    await mined(listings.connect(amazon).createListing(productId, retailNet.address, "AMZ-B0DEMO001-R"));
    assert.equal(await listings.verifyListing(3), Status.GENUINE);
  });

  await step("Unknown listing IDs report LISTING_NOT_FOUND", async () => {
    assert.equal(await listings.verifyListing(0), Status.LISTING_NOT_FOUND);
    assert.equal(await listings.verifyListing(999), Status.LISTING_NOT_FOUND);
  });

  await step("Pagination and counts agree with what was created", async () => {
    assert.equal(await listings.getListingCount(), 3n);
    assert.deepEqual([...(await listings.getProductListings(productId, 0, 10))], [1n, 2n, 3n]);
    assert.deepEqual([...(await listings.getMarketplaceListings(amazon.address, 0, 10))], [2n, 3n]);
    assert.deepEqual([...(await listings.getMarketplaceListings(amazon.address, 5, 10))], []);
    assert.equal(await products.getBrandCount(), 2n);
    assert.equal(await listings.getMarketplaceCount(), 2n);
  });

  await step("Both contracts reject plain ETH transfers", async () => {
    await expectEthRejected(admin, products);
    await expectEthRejected(admin, listings);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // Anything thrown outside a step (for example a deployment problem) is also a failure.
  console.error(error);
  process.exitCode = 1;
});
