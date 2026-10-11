// The whole VeriList story in one test, using the real names from the demo.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const Status = { GENUINE: 0n, SELLER_NOT_AUTHORIZED: 7n };

describe("Integration: the Fastrack watch story", function () {
  it("runs the full flow from brand verification to a live revocation", async function () {
    const [admin, fastrack, flipkart, amazon, retailNet, fakeDeals] = await ethers.getSigners();

    const products = await (await ethers.getContractFactory("ProductRegistry")).deploy();
    const listings = await (await ethers.getContractFactory("ListingRegistry")).deploy(await products.getAddress());

    // 1. The admin verifies Fastrack and registers Flipkart and Amazon.
    await products.connect(admin).verifyBrand(fastrack.address, "Fastrack");
    await listings.connect(admin).registerMarketplace(flipkart.address, "Flipkart");
    await listings.connect(admin).registerMarketplace(amazon.address, "Amazon");

    // 2. Fastrack registers a watch and authorizes RetailNet.
    const specsV1 = JSON.stringify({
      model: "Reflex Pro",
      category: "Smartwatch",
      specs: { battery: "7 days" },
      mrp: 2995,
      warranty: "1 year",
    });
    const sku = "FT-REFLEX-PRO";
    const productId = await products.computeProductId(fastrack.address, sku);
    await products.connect(fastrack).registerProduct(sku, "Reflex Pro", specsV1);
    await products.connect(fastrack).authorizeSeller(productId, retailNet.address);

    // 3. Flipkart lists the watch via RetailNet, and it shows as genuine.
    await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "FLIP-883021"))
      .to.emit(listings, "ListingCreated")
      .withArgs(1, productId, retailNet.address, flipkart.address, "FLIP-883021");
    expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);

    // 4. FakeDeals (not authorized) is rejected, both by the pre-check and by the transaction.
    expect(await listings.checkListingEligibility(productId, fakeDeals.address, flipkart.address)).to.equal(
      Status.SELLER_NOT_AUTHORIZED
    );
    await expect(listings.connect(flipkart).createListing(productId, fakeDeals.address, "FLIP-FAKE-1"))
      .to.be.revertedWithCustomError(listings, "SellerNotAuthorized")
      .withArgs(productId, fakeDeals.address);

    // Amazon also lists the same watch via RetailNet.
    await listings.connect(amazon).createListing(productId, retailNet.address, "AMZ-55120");
    expect(await listings.verifyListing(2)).to.equal(Status.GENUINE);

    // 5. Fastrack updates the specs once, and both marketplaces see version 2.
    const specsV2 = JSON.stringify({
      model: "Reflex Pro",
      category: "Smartwatch",
      specs: { battery: "10 days" },
      mrp: 3495,
      warranty: "2 years",
    });
    await products.connect(fastrack).updateProductDetails(productId, specsV2);

    expect(await products.getVersionCount(productId)).to.equal(2n);
    for (const listingId of [1, 2]) {
      const [, latest, status] = await listings.getListingWithDetails(listingId);
      expect(latest.details).to.equal(specsV2);
      expect(latest.detailsHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(specsV2)));
      expect(status).to.equal(Status.GENUINE);
    }
    // Version 1 is still there, untouched.
    expect((await products.getVersion(productId, 1)).details).to.equal(specsV1);

    // 6. Fastrack revokes RetailNet, and both listings flip to SELLER_NOT_AUTHORIZED at once.
    await products.connect(fastrack).revokeSeller(productId, retailNet.address);
    expect(await listings.verifyListing(1)).to.equal(Status.SELLER_NOT_AUTHORIZED);
    expect(await listings.verifyListing(2)).to.equal(Status.SELLER_NOT_AUTHORIZED);

    // Bonus: re-authorizing flips them back with no change to the listings themselves.
    await products.connect(fastrack).authorizeSeller(productId, retailNet.address);
    expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
    expect(await listings.verifyListing(2)).to.equal(Status.GENUINE);
  });
});
