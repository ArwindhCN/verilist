// Tests for ListingRegistry. Test names carry rule tags like [R10] so the README can map rules to tests.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Same order as the ListingStatus enum in the contract.
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
const DETAILS_V1 = JSON.stringify({ model: "Reflex Pro", specs: { battery: "7 days" }, mrp: 2995 });
const DETAILS_V2 = JSON.stringify({ model: "Reflex Pro", specs: { battery: "10 days" }, mrp: 3495 });
const hashOf = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

/**
 * Standard world used by most tests:
 *  - Fastrack and Titan are verified brands
 *  - Flipkart and Amazon are registered, active marketplaces
 *  - Fastrack has one product (`productId`), and RetailNet and QuickShop are authorized sellers for it
 *  - FakeDeals is NOT authorized
 */
async function worldFixture() {
  const [admin, fastrack, titan, flipkart, amazon, retailNet, quickShop, fakeDeals, stranger] =
    await ethers.getSigners();

  const products = await (await ethers.getContractFactory("ProductRegistry")).deploy();
  const listings = await (await ethers.getContractFactory("ListingRegistry")).deploy(await products.getAddress());

  await products.verifyBrand(fastrack.address, "Fastrack");
  await products.verifyBrand(titan.address, "Titan");
  await listings.registerMarketplace(flipkart.address, "Flipkart");
  await listings.registerMarketplace(amazon.address, "Amazon");

  await products.connect(fastrack).registerProduct(SKU, "Reflex Pro", DETAILS_V1);
  const productId = await products.computeProductId(fastrack.address, SKU);
  await products.connect(fastrack).authorizeSeller(productId, retailNet.address);
  await products.connect(fastrack).authorizeSeller(productId, quickShop.address);

  return {
    products,
    listings,
    productId,
    admin,
    fastrack,
    titan,
    flipkart,
    amazon,
    retailNet,
    quickShop,
    fakeDeals,
    stranger,
  };
}

/** The standard world plus one genuine listing (#1): Flipkart sells the watch via RetailNet. */
async function listedFixture() {
  const world = await worldFixture();
  await world.listings.connect(world.flipkart).createListing(world.productId, world.retailNet.address, "FLIP-1");
  return world;
}

describe("ListingRegistry", function () {
  describe("Constructor", function () {
    it("reverts for the zero address", async function () {
      const factory = await ethers.getContractFactory("ListingRegistry");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("stores the product registry and makes the deployer the owner", async function () {
      const { listings, products, admin } = await loadFixture(worldFixture);
      expect(await listings.registry()).to.equal(await products.getAddress());
      expect(await listings.owner()).to.equal(admin.address);
      expect(await listings.nextListingId()).to.equal(1n);
      expect(await listings.getListingCount()).to.equal(0n);
    });
  });

  describe("Marketplace admin functions", function () {
    it("[R1] registers a marketplace as active and emits MarketplaceRegistered", async function () {
      const { listings, stranger } = await loadFixture(worldFixture);
      await expect(listings.registerMarketplace(stranger.address, "Snapdeal"))
        .to.emit(listings, "MarketplaceRegistered")
        .withArgs(stranger.address, "Snapdeal");

      const m = await listings.getMarketplace(stranger.address);
      expect(m.name).to.equal("Snapdeal");
      expect(m.active).to.equal(true);
      expect(m.exists).to.equal(true);
      expect(await listings.getMarketplaceCount()).to.equal(3n);
    });

    it("[R1] registerMarketplace reverts for a non-admin", async function () {
      const { listings, stranger } = await loadFixture(worldFixture);
      await expect(listings.connect(stranger).registerMarketplace(stranger.address, "Snapdeal"))
        .to.be.revertedWithCustomError(listings, "NotOwner")
        .withArgs(stranger.address);
    });

    it("registerMarketplace rejects the zero address, an empty name and an over-long name", async function () {
      const { listings, stranger } = await loadFixture(worldFixture);
      await expect(listings.registerMarketplace(ethers.ZeroAddress, "X")).to.be.revertedWithCustomError(
        listings,
        "ZeroAddress"
      );
      await expect(listings.registerMarketplace(stranger.address, "")).to.be.revertedWithCustomError(
        listings,
        "EmptyName"
      );
      await expect(listings.registerMarketplace(stranger.address, "m".repeat(101)))
        .to.be.revertedWithCustomError(listings, "NameTooLong")
        .withArgs(101, 100);
      await expect(listings.registerMarketplace(stranger.address, "m".repeat(100))).to.not.be.reverted;
    });

    it("registerMarketplace reverts MarketplaceAlreadyRegistered for a duplicate", async function () {
      const { listings, flipkart } = await loadFixture(worldFixture);
      await expect(listings.registerMarketplace(flipkart.address, "Flipkart 2"))
        .to.be.revertedWithCustomError(listings, "MarketplaceAlreadyRegistered")
        .withArgs(flipkart.address);
    });

    it("[R1] setMarketplaceActive toggles both ways and emits MarketplaceStatusChanged", async function () {
      const { listings, flipkart } = await loadFixture(worldFixture);
      await expect(listings.setMarketplaceActive(flipkart.address, false))
        .to.emit(listings, "MarketplaceStatusChanged")
        .withArgs(flipkart.address, false);
      expect((await listings.getMarketplace(flipkart.address)).active).to.equal(false);

      await expect(listings.setMarketplaceActive(flipkart.address, true))
        .to.emit(listings, "MarketplaceStatusChanged")
        .withArgs(flipkart.address, true);
      expect((await listings.getMarketplace(flipkart.address)).active).to.equal(true);
    });

    it("[R1] setMarketplaceActive reverts for a non-admin", async function () {
      const { listings, flipkart, stranger } = await loadFixture(worldFixture);
      await expect(listings.connect(stranger).setMarketplaceActive(flipkart.address, false))
        .to.be.revertedWithCustomError(listings, "NotOwner")
        .withArgs(stranger.address);
      // Even the marketplace itself cannot change its own status.
      await expect(listings.connect(flipkart).setMarketplaceActive(flipkart.address, false))
        .to.be.revertedWithCustomError(listings, "NotOwner")
        .withArgs(flipkart.address);
    });

    it("setMarketplaceActive reverts StatusUnchanged when already in that state", async function () {
      const { listings, flipkart } = await loadFixture(worldFixture);
      await expect(listings.setMarketplaceActive(flipkart.address, true)).to.be.revertedWithCustomError(
        listings,
        "StatusUnchanged"
      );
      await listings.setMarketplaceActive(flipkart.address, false);
      await expect(listings.setMarketplaceActive(flipkart.address, false)).to.be.revertedWithCustomError(
        listings,
        "StatusUnchanged"
      );
    });

    it("setMarketplaceActive reverts for a marketplace that does not exist", async function () {
      const { listings, stranger } = await loadFixture(worldFixture);
      await expect(listings.setMarketplaceActive(stranger.address, false))
        .to.be.revertedWithCustomError(listings, "MarketplaceNotRegistered")
        .withArgs(stranger.address);
    });

    it("getMarketplace returns an empty record for an unknown wallet", async function () {
      const { listings, stranger } = await loadFixture(worldFixture);
      const m = await listings.getMarketplace(stranger.address);
      expect(m.exists).to.equal(false);
      expect(m.active).to.equal(false);
      expect(m.name).to.equal("");
    });

    it("two-step ownership transfer works here too (Ownable) and moves marketplace admin rights only after accepting", async function () {
      const { listings, admin, stranger } = await loadFixture(worldFixture);
      await expect(listings.transferOwnership(stranger.address))
        .to.emit(listings, "OwnershipTransferStarted")
        .withArgs(admin.address, stranger.address);
      // Offer only: nothing has moved yet.
      await expect(listings.connect(stranger).registerMarketplace(admin.address, "Old admin"))
        .to.be.revertedWithCustomError(listings, "NotOwner")
        .withArgs(stranger.address);

      await expect(listings.connect(stranger).acceptOwnership())
        .to.emit(listings, "OwnershipTransferred")
        .withArgs(admin.address, stranger.address);
      await expect(listings.registerMarketplace(admin.address, "Old admin")).to.be.revertedWithCustomError(
        listings,
        "NotOwner"
      );
      await expect(listings.connect(stranger).registerMarketplace(admin.address, "Old admin")).to.not.be.reverted;
    });
  });

  describe("createListing: happy path", function () {
    it("[R7] creates a listing, emits ListingCreated and stores every field", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "FLIP-883021"))
        .to.emit(listings, "ListingCreated")
        .withArgs(1, productId, retailNet.address, flipkart.address, "FLIP-883021");

      const listing = await listings.getListing(1);
      expect(listing.id).to.equal(1n);
      expect(listing.productId).to.equal(productId);
      expect(listing.seller).to.equal(retailNet.address);
      expect(listing.marketplace).to.equal(flipkart.address);
      expect(listing.externalRef).to.equal("FLIP-883021");
      expect(listing.createdAt).to.equal(await time.latest());
      expect(listing.active).to.equal(true);
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
    });

    it("increments listing IDs starting from 1", async function () {
      const { listings, productId, flipkart, amazon, retailNet, quickShop } = await loadFixture(worldFixture);
      const asFlipkart = listings.connect(flipkart);
      expect(await asFlipkart.createListing.staticCall(productId, retailNet.address, "A")).to.equal(1n);
      await asFlipkart.createListing(productId, retailNet.address, "A");
      expect(await asFlipkart.createListing.staticCall(productId, quickShop.address, "B")).to.equal(2n);
      await asFlipkart.createListing(productId, quickShop.address, "B");
      expect(await listings.connect(amazon).createListing.staticCall(productId, retailNet.address, "A")).to.equal(3n);

      expect(await listings.getListingCount()).to.equal(2n);
      expect(await listings.nextListingId()).to.equal(3n);
    });

    it("tracks listings per marketplace and per product", async function () {
      const { listings, productId, flipkart, amazon, retailNet, quickShop } = await loadFixture(worldFixture);
      await listings.connect(flipkart).createListing(productId, retailNet.address, "F1");
      await listings.connect(amazon).createListing(productId, quickShop.address, "A1");
      await listings.connect(flipkart).createListing(productId, quickShop.address, "F2");

      expect(await listings.getMarketplaceListings(flipkart.address, 0, 10)).to.deep.equal([1n, 3n]);
      expect(await listings.getMarketplaceListings(amazon.address, 0, 10)).to.deep.equal([2n]);
      expect(await listings.getProductListings(productId, 0, 10)).to.deep.equal([1n, 2n, 3n]);
    });

    it("allows exactly the maximum external reference length", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "r".repeat(64))).to.not.be
        .reverted;
    });

    it("lets the brand sell its own product once it authorizes itself (official store)", async function () {
      const { listings, products, productId, fastrack, flipkart } = await loadFixture(worldFixture);
      await products.connect(fastrack).authorizeSeller(productId, fastrack.address);
      await expect(listings.connect(flipkart).createListing(productId, fastrack.address, "OFFICIAL-1")).to.not.be
        .reverted;
    });
  });

  describe("createListing: every rejection reason", function () {
    it("[R6] rejects a caller that is not a registered marketplace", async function () {
      const { listings, productId, retailNet, stranger } = await loadFixture(worldFixture);
      await expect(listings.connect(stranger).createListing(productId, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "MarketplaceNotRegistered")
        .withArgs(stranger.address);
    });

    it("[R6] rejects a brand or seller calling createListing (wrong role)", async function () {
      const { listings, productId, fastrack, retailNet } = await loadFixture(worldFixture);
      await expect(listings.connect(fastrack).createListing(productId, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "MarketplaceNotRegistered")
        .withArgs(fastrack.address);
      await expect(listings.connect(retailNet).createListing(productId, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "MarketplaceNotRegistered")
        .withArgs(retailNet.address);
    });

    it("[R6] rejects an inactive marketplace", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(worldFixture);
      await listings.setMarketplaceActive(flipkart.address, false);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "MarketplaceNotActive")
        .withArgs(flipkart.address);
    });

    it("[R7] rejects a product that does not exist", async function () {
      const { listings, flipkart, retailNet } = await loadFixture(worldFixture);
      const unknown = ethers.id("no-such-product");
      await expect(listings.connect(flipkart).createListing(unknown, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "ProductNotFound")
        .withArgs(unknown);
    });

    it("[R7] rejects a product whose brand was revoked", async function () {
      const { listings, products, productId, fastrack, flipkart, retailNet } = await loadFixture(worldFixture);
      await products.revokeBrand(fastrack.address);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "BrandNotVerified")
        .withArgs(fastrack.address);
    });

    it("[R7] rejects an inactive product", async function () {
      const { listings, products, productId, fastrack, flipkart, retailNet } = await loadFixture(worldFixture);
      await products.connect(fastrack).setProductActive(productId, false);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "ProductInactive")
        .withArgs(productId);
    });

    it("[R7] rejects a seller the brand has not authorized", async function () {
      const { listings, productId, flipkart, fakeDeals } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, fakeDeals.address, "X"))
        .to.be.revertedWithCustomError(listings, "SellerNotAuthorized")
        .withArgs(productId, fakeDeals.address);
    });

    it("[R7] rejects a seller whose authorization was revoked", async function () {
      const { listings, products, productId, fastrack, flipkart, retailNet } = await loadFixture(worldFixture);
      await products.connect(fastrack).revokeSeller(productId, retailNet.address);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "X"))
        .to.be.revertedWithCustomError(listings, "SellerNotAuthorized")
        .withArgs(productId, retailNet.address);
    });

    it("[R7] rejects the zero address as seller (it can never be authorized)", async function () {
      const { listings, productId, flipkart } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, ethers.ZeroAddress, "X"))
        .to.be.revertedWithCustomError(listings, "SellerNotAuthorized")
        .withArgs(productId, ethers.ZeroAddress);
    });

    it("[R8] rejects a duplicate active listing and reports the existing listing ID", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(listedFixture);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "FLIP-2"))
        .to.be.revertedWithCustomError(listings, "DuplicateListing")
        .withArgs(1);
    });

    it("rejects an empty external reference", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "")).to.be.revertedWithCustomError(
        listings,
        "EmptyExternalRef"
      );
    });

    it("rejects an over-long external reference", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "r".repeat(65)))
        .to.be.revertedWithCustomError(listings, "ExternalRefTooLong")
        .withArgs(65, 64);
    });

    it("rejects an external reference the marketplace already used", async function () {
      const { listings, productId, flipkart, quickShop } = await loadFixture(listedFixture);
      await expect(listings.connect(flipkart).createListing(productId, quickShop.address, "FLIP-1"))
        .to.be.revertedWithCustomError(listings, "ExternalRefAlreadyUsed")
        .withArgs("FLIP-1");
    });

    it("checks in the documented order: product, brand, inactive, seller, duplicate, then reference", async function () {
      const { listings, products, productId, fastrack, flipkart, retailNet, fakeDeals } = await loadFixture(listedFixture);
      const unknown = ethers.id("no-such-product");
      const asFlipkart = listings.connect(flipkart);

      // Everything wrong at once -> the first check in the list wins.
      await products.revokeBrand(fastrack.address);
      await expect(asFlipkart.createListing(unknown, fakeDeals.address, "")).to.be.revertedWithCustomError(
        listings,
        "ProductNotFound"
      );
      // Known product, brand revoked, product inactive-able, seller bad, duplicate, bad ref -> brand check wins.
      await expect(asFlipkart.createListing(productId, retailNet.address, "")).to.be.revertedWithCustomError(
        listings,
        "BrandNotVerified"
      );
      await products.verifyBrand(fastrack.address, "Fastrack");
      await products.connect(fastrack).setProductActive(productId, false);
      await expect(asFlipkart.createListing(productId, fakeDeals.address, "")).to.be.revertedWithCustomError(
        listings,
        "ProductInactive"
      );
      await products.connect(fastrack).setProductActive(productId, true);
      await expect(asFlipkart.createListing(productId, fakeDeals.address, "")).to.be.revertedWithCustomError(
        listings,
        "SellerNotAuthorized"
      );
      // Duplicate beats a bad reference.
      await expect(asFlipkart.createListing(productId, retailNet.address, "")).to.be.revertedWithCustomError(
        listings,
        "DuplicateListing"
      );
    });

    it("leaves state untouched when a creation attempt is rejected", async function () {
      const { listings, productId, flipkart, fakeDeals } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, fakeDeals.address, "X")).to.be.reverted;
      expect(await listings.getListingCount()).to.equal(0n);
      expect(await listings.getProductListings(productId, 0, 10)).to.deep.equal([]);
    });
  });

  describe("Cross-marketplace and re-listing", function () {
    it("[R8] allows the same product and seller on a different marketplace", async function () {
      const { listings, productId, amazon, retailNet } = await loadFixture(listedFixture);
      await expect(listings.connect(amazon).createListing(productId, retailNet.address, "AMZ-1"))
        .to.emit(listings, "ListingCreated")
        .withArgs(2, productId, retailNet.address, amazon.address, "AMZ-1");
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
      expect(await listings.verifyListing(2)).to.equal(Status.GENUINE);
      expect((await listings.getListing(2)).marketplace).to.equal(amazon.address);
    });

    it("[R8] allows a different seller for the same product on the same marketplace", async function () {
      const { listings, productId, flipkart, quickShop } = await loadFixture(listedFixture);
      await expect(listings.connect(flipkart).createListing(productId, quickShop.address, "FLIP-2")).to.not.be.reverted;
    });

    it("[R8] allows re-listing after removal, with a new external reference", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(listedFixture);
      await listings.connect(flipkart).removeListing(1);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "FLIP-1B"))
        .to.emit(listings, "ListingCreated")
        .withArgs(2, productId, retailNet.address, flipkart.address, "FLIP-1B");
      expect(await listings.verifyListing(1)).to.equal(Status.LISTING_REMOVED);
      expect(await listings.verifyListing(2)).to.equal(Status.GENUINE);
    });

    it("[R8] a removed listing's external reference stays used (re-listing needs a new one)", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(listedFixture);
      await listings.connect(flipkart).removeListing(1);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "FLIP-1"))
        .to.be.revertedWithCustomError(listings, "ExternalRefAlreadyUsed")
        .withArgs("FLIP-1");
    });

    it("different marketplaces may use the same external reference text", async function () {
      const { listings, productId, amazon, retailNet } = await loadFixture(listedFixture);
      await expect(listings.connect(amazon).createListing(productId, retailNet.address, "FLIP-1")).to.not.be.reverted;
    });
  });

  describe("removeListing", function () {
    it("[R11] lets the marketplace remove its listing and emits ListingRemoved", async function () {
      const { listings, flipkart } = await loadFixture(listedFixture);
      await expect(listings.connect(flipkart).removeListing(1))
        .to.emit(listings, "ListingRemoved")
        .withArgs(1, flipkart.address);
      expect((await listings.getListing(1)).active).to.equal(false);
      expect(await listings.verifyListing(1)).to.equal(Status.LISTING_REMOVED);
    });

    it("[R11] lets the seller remove the listing", async function () {
      const { listings, retailNet } = await loadFixture(listedFixture);
      await expect(listings.connect(retailNet).removeListing(1))
        .to.emit(listings, "ListingRemoved")
        .withArgs(1, retailNet.address);
      expect(await listings.verifyListing(1)).to.equal(Status.LISTING_REMOVED);
    });

    it("[R11] reverts NotListingParty for a stranger, the brand, another marketplace and another seller", async function () {
      const { listings, stranger, fastrack, amazon, quickShop } = await loadFixture(listedFixture);
      for (const who of [stranger, fastrack, amazon, quickShop]) {
        await expect(listings.connect(who).removeListing(1))
          .to.be.revertedWithCustomError(listings, "NotListingParty")
          .withArgs(1, who.address);
      }
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
    });

    it("reverts ListingNotActive when removing twice", async function () {
      const { listings, flipkart, retailNet } = await loadFixture(listedFixture);
      await listings.connect(flipkart).removeListing(1);
      await expect(listings.connect(flipkart).removeListing(1))
        .to.be.revertedWithCustomError(listings, "ListingNotActive")
        .withArgs(1);
      await expect(listings.connect(retailNet).removeListing(1))
        .to.be.revertedWithCustomError(listings, "ListingNotActive")
        .withArgs(1);
    });

    it("reverts ListingNotFound for an ID that does not exist (including 0)", async function () {
      const { listings, flipkart } = await loadFixture(listedFixture);
      await expect(listings.connect(flipkart).removeListing(99))
        .to.be.revertedWithCustomError(listings, "ListingNotFound")
        .withArgs(99);
      await expect(listings.connect(flipkart).removeListing(0))
        .to.be.revertedWithCustomError(listings, "ListingNotFound")
        .withArgs(0);
    });

    it("lets a deactivated marketplace still remove its own listings (clean-up must stay possible)", async function () {
      const { listings, flipkart } = await loadFixture(listedFixture);
      await listings.setMarketplaceActive(flipkart.address, false);
      await expect(listings.connect(flipkart).removeListing(1)).to.not.be.reverted;
    });

    it("lets the seller remove its listing even after the brand revoked it", async function () {
      const { listings, products, productId, fastrack, retailNet } = await loadFixture(listedFixture);
      await products.connect(fastrack).revokeSeller(productId, retailNet.address);
      await expect(listings.connect(retailNet).removeListing(1)).to.not.be.reverted;
    });
  });

  describe("verifyListing is live", function () {
    it("[R10] reports LISTING_NOT_FOUND for IDs that were never created (including 0)", async function () {
      const { listings } = await loadFixture(listedFixture);
      expect(await listings.verifyListing(0)).to.equal(Status.LISTING_NOT_FOUND);
      expect(await listings.verifyListing(2)).to.equal(Status.LISTING_NOT_FOUND);
      expect(await listings.verifyListing(12345)).to.equal(Status.LISTING_NOT_FOUND);
    });

    it("[R10] flips to SELLER_NOT_AUTHORIZED when the brand revokes the seller, and back when re-authorized", async function () {
      const { listings, products, productId, fastrack, retailNet } = await loadFixture(listedFixture);
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
      await products.connect(fastrack).revokeSeller(productId, retailNet.address);
      expect(await listings.verifyListing(1)).to.equal(Status.SELLER_NOT_AUTHORIZED);
      await products.connect(fastrack).authorizeSeller(productId, retailNet.address);
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
    });

    it("[R10] flips to PRODUCT_INACTIVE when the brand deactivates the product, and back when reactivated", async function () {
      const { listings, products, productId, fastrack } = await loadFixture(listedFixture);
      await products.connect(fastrack).setProductActive(productId, false);
      expect(await listings.verifyListing(1)).to.equal(Status.PRODUCT_INACTIVE);
      await products.connect(fastrack).setProductActive(productId, true);
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
    });

    it("[R10] flips to BRAND_NOT_VERIFIED when the admin revokes the brand, and back when re-verified", async function () {
      const { listings, products, fastrack } = await loadFixture(listedFixture);
      await products.revokeBrand(fastrack.address);
      expect(await listings.verifyListing(1)).to.equal(Status.BRAND_NOT_VERIFIED);
      await products.verifyBrand(fastrack.address, "Fastrack");
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
    });

    it("[R10] flips to MARKETPLACE_INACTIVE when the admin deactivates the marketplace, and back when reactivated", async function () {
      const { listings, flipkart } = await loadFixture(listedFixture);
      await listings.setMarketplaceActive(flipkart.address, false);
      expect(await listings.verifyListing(1)).to.equal(Status.MARKETPLACE_INACTIVE);
      await listings.setMarketplaceActive(flipkart.address, true);
      expect(await listings.verifyListing(1)).to.equal(Status.GENUINE);
    });

    it("[R10] a removed listing stays LISTING_REMOVED", async function () {
      const { listings, flipkart } = await loadFixture(listedFixture);
      await listings.connect(flipkart).removeListing(1);
      expect(await listings.verifyListing(1)).to.equal(Status.LISTING_REMOVED);
    });

    it("[R10] only the affected listings change: other sellers and other marketplaces stay genuine", async function () {
      const { listings, products, productId, fastrack, flipkart, amazon, retailNet, quickShop } =
        await loadFixture(listedFixture);
      await listings.connect(amazon).createListing(productId, retailNet.address, "AMZ-1"); // #2
      await listings.connect(flipkart).createListing(productId, quickShop.address, "FLIP-2"); // #3

      await products.connect(fastrack).revokeSeller(productId, retailNet.address);
      expect(await listings.verifyListing(1)).to.equal(Status.SELLER_NOT_AUTHORIZED); // RetailNet on Flipkart
      expect(await listings.verifyListing(2)).to.equal(Status.SELLER_NOT_AUTHORIZED); // RetailNet on Amazon
      expect(await listings.verifyListing(3)).to.equal(Status.GENUINE); // QuickShop is untouched

      await listings.setMarketplaceActive(amazon.address, false);
      expect(await listings.verifyListing(2)).to.equal(Status.MARKETPLACE_INACTIVE);
      expect(await listings.verifyListing(3)).to.equal(Status.GENUINE);
    });

    it("[R10] reports the first failing check when several things are wrong at once", async function () {
      const { listings, products, productId, fastrack, flipkart, retailNet } = await loadFixture(listedFixture);

      // Seller revoked + product inactive -> PRODUCT_INACTIVE comes first.
      await products.connect(fastrack).revokeSeller(productId, retailNet.address);
      await products.connect(fastrack).setProductActive(productId, false);
      expect(await listings.verifyListing(1)).to.equal(Status.PRODUCT_INACTIVE);

      // + brand revoked -> BRAND_NOT_VERIFIED comes first.
      await products.revokeBrand(fastrack.address);
      expect(await listings.verifyListing(1)).to.equal(Status.BRAND_NOT_VERIFIED);

      // + marketplace inactive -> MARKETPLACE_INACTIVE comes first.
      await listings.setMarketplaceActive(flipkart.address, false);
      expect(await listings.verifyListing(1)).to.equal(Status.MARKETPLACE_INACTIVE);

      // + listing removed -> LISTING_REMOVED comes first.
      await listings.connect(retailNet).removeListing(1);
      expect(await listings.verifyListing(1)).to.equal(Status.LISTING_REMOVED);
    });

    it("[R10] needs no transaction on the listing itself (no listing event is emitted when things flip)", async function () {
      const { listings, products, productId, fastrack, retailNet } = await loadFixture(listedFixture);
      const tx = await products.connect(fastrack).revokeSeller(productId, retailNet.address);
      const receipt = await tx.wait();
      // Only the ProductRegistry was touched; the ListingRegistry saw nothing, yet the verdict changed.
      const listingsAddress = await listings.getAddress();
      expect(receipt.logs.some((log) => log.address === listingsAddress)).to.equal(false);
      expect(await listings.verifyListing(1)).to.equal(Status.SELLER_NOT_AUTHORIZED);
    });
  });

  describe("Update propagation", function () {
    it("[R9] one brand update shows as version 2 on both Flipkart and Amazon listings", async function () {
      const { listings, products, productId, fastrack, amazon, retailNet } = await loadFixture(listedFixture);
      await listings.connect(amazon).createListing(productId, retailNet.address, "AMZ-1"); // #2

      for (const id of [1, 2]) {
        const [, latest, status] = await listings.getListingWithDetails(id);
        expect(latest.details).to.equal(DETAILS_V1);
        expect(latest.detailsHash).to.equal(hashOf(DETAILS_V1));
        expect(status).to.equal(Status.GENUINE);
      }
      expect(await products.getVersionCount(productId)).to.equal(1n);

      await products.connect(fastrack).updateProductDetails(productId, DETAILS_V2);

      expect(await products.getVersionCount(productId)).to.equal(2n);
      for (const id of [1, 2]) {
        const [listing, latest, status] = await listings.getListingWithDetails(id);
        expect(listing.id).to.equal(BigInt(id));
        expect(latest.details).to.equal(DETAILS_V2);
        expect(latest.detailsHash).to.equal(hashOf(DETAILS_V2));
        expect(status).to.equal(Status.GENUINE);
      }
    });

    it("[R9] marketplaces have no function that changes product details", async function () {
      const { listings, products, productId, flipkart } = await loadFixture(listedFixture);
      // The only way to change details is ProductRegistry.updateProductDetails, and it is brand-only.
      await expect(products.connect(flipkart).updateProductDetails(productId, DETAILS_V2))
        .to.be.revertedWithCustomError(products, "NotProductBrand")
        .withArgs(productId, flipkart.address);
      const names = listings.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      expect(names.filter((n) => /update|setDetails|setProduct/i.test(n))).to.deep.equal([]);
    });

    it("[R9] getListingWithDetails returns the latest version together with the live status", async function () {
      const { listings, products, productId, fastrack, retailNet } = await loadFixture(listedFixture);
      await products.connect(fastrack).revokeSeller(productId, retailNet.address);
      const [listing, latest, status] = await listings.getListingWithDetails(1);
      expect(listing.productId).to.equal(productId);
      expect(latest.details).to.equal(DETAILS_V1);
      expect(status).to.equal(Status.SELLER_NOT_AUTHORIZED);
    });

    it("getListing and getListingWithDetails revert ListingNotFound for unknown IDs", async function () {
      const { listings } = await loadFixture(listedFixture);
      await expect(listings.getListing(0)).to.be.revertedWithCustomError(listings, "ListingNotFound").withArgs(0);
      await expect(listings.getListing(7)).to.be.revertedWithCustomError(listings, "ListingNotFound").withArgs(7);
      await expect(listings.getListingWithDetails(7))
        .to.be.revertedWithCustomError(listings, "ListingNotFound")
        .withArgs(7);
    });
  });

  describe("checkListingEligibility", function () {
    // Each case sets up a situation, then checks that the pre-check view and createListing agree.
    // `expectedError` is the custom error createListing must revert with; null means it must succeed.
    const cases = [
      {
        name: "everything fine",
        status: Status.GENUINE,
        setup: async () => {},
        error: null,
      },
      {
        name: "marketplace not registered",
        status: Status.MARKETPLACE_INACTIVE,
        marketplace: "stranger",
        setup: async () => {},
        error: ["MarketplaceNotRegistered", (w) => [w.stranger.address]],
      },
      {
        name: "marketplace inactive",
        status: Status.MARKETPLACE_INACTIVE,
        setup: async (w) => w.listings.setMarketplaceActive(w.flipkart.address, false),
        error: ["MarketplaceNotActive", (w) => [w.flipkart.address]],
      },
      {
        name: "product not found",
        status: Status.PRODUCT_NOT_FOUND,
        productId: ethers.id("no-such-product"),
        setup: async () => {},
        error: ["ProductNotFound", () => [ethers.id("no-such-product")]],
      },
      {
        name: "brand revoked",
        status: Status.BRAND_NOT_VERIFIED,
        setup: async (w) => w.products.revokeBrand(w.fastrack.address),
        error: ["BrandNotVerified", (w) => [w.fastrack.address]],
      },
      {
        name: "product inactive",
        status: Status.PRODUCT_INACTIVE,
        setup: async (w) => w.products.connect(w.fastrack).setProductActive(w.productId, false),
        error: ["ProductInactive", (w) => [w.productId]],
      },
      {
        name: "seller not authorized",
        status: Status.SELLER_NOT_AUTHORIZED,
        seller: "fakeDeals",
        setup: async () => {},
        error: ["SellerNotAuthorized", (w) => [w.productId, w.fakeDeals.address]],
      },
      {
        name: "seller revoked",
        status: Status.SELLER_NOT_AUTHORIZED,
        setup: async (w) => w.products.connect(w.fastrack).revokeSeller(w.productId, w.retailNet.address),
        error: ["SellerNotAuthorized", (w) => [w.productId, w.retailNet.address]],
      },
      {
        name: "duplicate active listing",
        status: Status.DUPLICATE_LISTING,
        setup: async (w) => w.listings.connect(w.flipkart).createListing(w.productId, w.retailNet.address, "EXISTING"),
        error: ["DuplicateListing", () => [1]],
      },
    ];

    for (const c of cases) {
      it(`returns the same reason createListing reverts with: ${c.name}`, async function () {
        const world = await loadFixture(worldFixture);
        await c.setup(world);

        const marketplace = world[c.marketplace || "flipkart"];
        const seller = world[c.seller || "retailNet"];
        const productId = c.productId || world.productId;

        expect(await world.listings.checkListingEligibility(productId, seller.address, marketplace.address)).to.equal(
          c.status
        );

        const attempt = world.listings.connect(marketplace).createListing(productId, seller.address, "NEW-REF");
        if (c.error === null) {
          await expect(attempt).to.emit(world.listings, "ListingCreated");
        } else {
          const [errorName, makeArgs] = c.error;
          await expect(attempt)
            .to.be.revertedWithCustomError(world.listings, errorName)
            .withArgs(...makeArgs(world));
        }
      });
    }

    it("[R8] stops reporting DUPLICATE_LISTING once the listing is removed", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(listedFixture);
      expect(await listings.checkListingEligibility(productId, retailNet.address, flipkart.address)).to.equal(
        Status.DUPLICATE_LISTING
      );
      await listings.connect(flipkart).removeListing(1);
      expect(await listings.checkListingEligibility(productId, retailNet.address, flipkart.address)).to.equal(
        Status.GENUINE
      );
    });

    it("reports GENUINE for the same product and seller on a different marketplace", async function () {
      const { listings, productId, amazon, retailNet } = await loadFixture(listedFixture);
      expect(await listings.checkListingEligibility(productId, retailNet.address, amazon.address)).to.equal(
        Status.GENUINE
      );
    });
  });

  describe("Pagination and helpers", function () {
    it("getMarketplaces respects offset and limit and returns empty at or beyond the end", async function () {
      const { listings, flipkart, amazon } = await loadFixture(worldFixture);
      expect(await listings.getMarketplaces(0, 10)).to.deep.equal([flipkart.address, amazon.address]);
      expect(await listings.getMarketplaces(1, 10)).to.deep.equal([amazon.address]);
      expect(await listings.getMarketplaces(0, 1)).to.deep.equal([flipkart.address]);
      expect(await listings.getMarketplaces(2, 10)).to.deep.equal([]);
      expect(await listings.getMarketplaces(50, 10)).to.deep.equal([]);
      expect(await listings.getMarketplaces(0, 0)).to.deep.equal([]);
      expect(await listings.getMarketplaceCount()).to.equal(2n);
    });

    it("getMarketplaceListings and getProductListings respect offset and limit", async function () {
      const { listings, productId, flipkart, quickShop } = await loadFixture(listedFixture);
      await listings.connect(flipkart).createListing(productId, quickShop.address, "FLIP-2"); // #2

      expect(await listings.getMarketplaceListings(flipkart.address, 0, 1)).to.deep.equal([1n]);
      expect(await listings.getMarketplaceListings(flipkart.address, 1, 10)).to.deep.equal([2n]);
      expect(await listings.getMarketplaceListings(flipkart.address, 2, 10)).to.deep.equal([]);
      expect(await listings.getMarketplaceListings(flipkart.address, 99, 10)).to.deep.equal([]);

      expect(await listings.getProductListings(productId, 0, 10)).to.deep.equal([1n, 2n]);
      expect(await listings.getProductListings(productId, 1, 1)).to.deep.equal([2n]);
      expect(await listings.getProductListings(productId, 2, 10)).to.deep.equal([]);
      expect(await listings.getProductListings(ethers.id("other"), 0, 10)).to.deep.equal([]);
    });

    it("removed listings stay in the per-marketplace and per-product lists", async function () {
      const { listings, productId, flipkart } = await loadFixture(listedFixture);
      await listings.connect(flipkart).removeListing(1);
      expect(await listings.getMarketplaceListings(flipkart.address, 0, 10)).to.deep.equal([1n]);
      expect(await listings.getProductListings(productId, 0, 10)).to.deep.equal([1n]);
      expect(await listings.getListingCount()).to.equal(1n);
    });

    it("computeListingKey equals keccak256(abi.encode(productId, seller, marketplace))", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(worldFixture);
      const manual = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "address"],
          [productId, retailNet.address, flipkart.address]
        )
      );
      expect(await listings.computeListingKey(productId, retailNet.address, flipkart.address)).to.equal(manual);
    });
  });

  describe("ETH handling", function () {
    it("reverts when ETH is sent to the contract (no receive/fallback)", async function () {
      const { listings, admin } = await loadFixture(worldFixture);
      await expect(admin.sendTransaction({ to: await listings.getAddress(), value: 1n })).to.be.reverted;
    });

    it("reverts when ETH is sent with calldata that matches no function", async function () {
      const { listings, admin } = await loadFixture(worldFixture);
      await expect(admin.sendTransaction({ to: await listings.getAddress(), value: 1n, data: "0x12345678" })).to.be
        .reverted;
    });

    it("reverts when ETH is attached to a normal call (functions are not payable)", async function () {
      const { listings, productId, flipkart, retailNet } = await loadFixture(worldFixture);
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "PAY-1", { value: 1n })).to.be
        .reverted;
    });
  });

  describe("Events (rule R12)", function () {
    it("[R12] every state-changing function emits its event", async function () {
      const { listings, products, productId, admin, fastrack, flipkart, retailNet, stranger } =
        await loadFixture(worldFixture);
      await expect(listings.registerMarketplace(stranger.address, "Snapdeal")).to.emit(
        listings,
        "MarketplaceRegistered"
      );
      await expect(listings.setMarketplaceActive(stranger.address, false)).to.emit(
        listings,
        "MarketplaceStatusChanged"
      );
      await expect(listings.connect(flipkart).createListing(productId, retailNet.address, "E-1")).to.emit(
        listings,
        "ListingCreated"
      );
      await expect(listings.connect(flipkart).removeListing(1)).to.emit(listings, "ListingRemoved");
      await expect(listings.transferOwnership(stranger.address)).to.emit(listings, "OwnershipTransferStarted");
      await expect(listings.connect(stranger).acceptOwnership()).to.emit(listings, "OwnershipTransferred");

      // ...and the same for the ProductRegistry's own functions.
      await expect(products.verifyBrand(stranger.address, "S")).to.emit(products, "BrandVerified");
      await expect(products.revokeBrand(stranger.address)).to.emit(products, "BrandRevoked");
      await expect(products.connect(fastrack).registerProduct("S2", "S2", "{}")).to.emit(
        products,
        "ProductRegistered"
      );
      await expect(products.connect(fastrack).updateProductDetails(productId, DETAILS_V2)).to.emit(
        products,
        "VersionAdded"
      );
      await expect(products.connect(fastrack).setProductActive(productId, false)).to.emit(
        products,
        "ProductStatusChanged"
      );
      await expect(products.connect(fastrack).authorizeSeller(productId, admin.address)).to.emit(
        products,
        "SellerAuthorized"
      );
      await expect(products.connect(fastrack).revokeSeller(productId, admin.address)).to.emit(
        products,
        "SellerRevoked"
      );
      await expect(products.transferOwnership(stranger.address)).to.emit(products, "OwnershipTransferStarted");
      await expect(products.connect(stranger).acceptOwnership()).to.emit(products, "OwnershipTransferred");
    });
  });
});
