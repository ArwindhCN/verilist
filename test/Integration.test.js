// The whole VeriList story in one test, using the real names from the demo.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

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

  it("admin safety: hand the admin role to a 2-of-3 multisig with a timelock, then cancel a bad proposal", async function () {
    const [admin, s1, s2, s3, fastrack, amazon] = await ethers.getSigners();
    const HOUR = 3600;

    const products = await (await ethers.getContractFactory("ProductRegistry")).deploy();
    const listings = await (await ethers.getContractFactory("ListingRegistry")).deploy(await products.getAddress());
    const multisig = await (await ethers.getContractFactory("AdminMultisig")).deploy(
      [s1.address, s2.address, s3.address],
      2,
      HOUR
    );
    const multisigAddress = await multisig.getAddress();
    const call = (registry, fn, args = []) => registry.interface.encodeFunctionData(fn, args);

    // Day one: a single admin wallet runs everything.
    await products.verifyBrand(fastrack.address, "Fastrack");

    // 1. Step one of the handover: the admin only OFFERS ownership. Nothing changes yet.
    await products.transferOwnership(multisigAddress);
    await listings.transferOwnership(multisigAddress);
    expect(await products.owner()).to.equal(admin.address);
    expect(await products.pendingOwner()).to.equal(multisigAddress);

    // 2. Step two: the multisig itself accepts, through its own approval process and timelock.
    const productsAddress = await products.getAddress();
    const listingsAddress = await listings.getAddress();
    await multisig.connect(s1).propose(productsAddress, call(products, "acceptOwnership")); // proposal 1
    await multisig.connect(s1).propose(listingsAddress, call(listings, "acceptOwnership")); // proposal 2
    await multisig.connect(s2).approve(1);
    await multisig.connect(s2).approve(2);
    await expect(multisig.execute(1)).to.be.revertedWithCustomError(multisig, "TimelockNotElapsed");
    await time.increase(HOUR);
    await multisig.execute(1);
    await multisig.execute(2);
    expect(await products.owner()).to.equal(multisigAddress);
    expect(await listings.owner()).to.equal(multisigAddress);

    // 3. The old admin wallet has no power left.
    await expect(products.verifyBrand(fastrack.address, "Again"))
      .to.be.revertedWithCustomError(products, "NotOwner")
      .withArgs(admin.address);
    await expect(listings.registerMarketplace(amazon.address, "Amazon"))
      .to.be.revertedWithCustomError(listings, "NotOwner")
      .withArgs(admin.address);

    // 4. One signer alone (a stolen key, or a rogue person) cannot do anything.
    await multisig.connect(s1).propose(productsAddress, call(products, "revokeBrand", [fastrack.address])); // proposal 3
    await time.increase(HOUR * 5);
    await expect(multisig.execute(3)).to.be.revertedWithCustomError(multisig, "NotEnoughApprovals");

    // 5. The normal path works: two signers agree, the timelock passes, anyone executes.
    await multisig.connect(s1).propose(listingsAddress, call(listings, "registerMarketplace", [amazon.address, "Amazon"])); // 4
    await multisig.connect(s2).approve(4);
    await time.increase(HOUR);
    await multisig.connect(fastrack).execute(4);
    expect((await listings.getMarketplace(amazon.address)).active).to.equal(true);

    // 6. A bad proposal is caught during the waiting time and cancelled by withdrawing an approval.
    await multisig.connect(s2).approve(3); // s1 + s2 now back "revoke Fastrack"; the timelock starts
    await expect(multisig.execute(3)).to.be.revertedWithCustomError(multisig, "TimelockNotElapsed");
    await multisig.connect(s2).revokeApproval(3); // s2 notices the mistake in time
    await time.increase(HOUR * 2);
    await expect(multisig.execute(3)).to.be.revertedWithCustomError(multisig, "NotEnoughApprovals");
    expect((await products.getBrand(fastrack.address)).verified).to.equal(true); // Fastrack is still verified
  });
});
