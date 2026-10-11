// Tests for Ownable (through ProductRegistry) and ProductRegistry.
// Test names carry rule tags like [R3] so the README can map each rule to its tests.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const SKU = "FT-REFLEX-PRO";
const NAME = "Reflex Pro";
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

/** Fresh contract, nobody verified yet. */
async function deployFixture() {
  const [admin, fastrack, titan, retailNet, quickShop, stranger] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("ProductRegistry")).deploy();
  return { registry, admin, fastrack, titan, retailNet, quickShop, stranger };
}

/** Fastrack and Titan are verified brands. */
async function brandsFixture() {
  const base = await deployFixture();
  await base.registry.verifyBrand(base.fastrack.address, "Fastrack");
  await base.registry.verifyBrand(base.titan.address, "Titan");
  return base;
}

/** Fastrack has registered one product (version 1). */
async function productFixture() {
  const base = await brandsFixture();
  const productId = await base.registry.computeProductId(base.fastrack.address, SKU);
  await base.registry.connect(base.fastrack).registerProduct(SKU, NAME, DETAILS_V1);
  return { ...base, productId };
}

describe("ProductRegistry", function () {
  describe("Deployment and Ownable", function () {
    it("sets the deployer as owner and emits OwnershipTransferred", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(admin.address);
      const factory = await ethers.getContractFactory("ProductRegistry");
      const fresh = await factory.deploy();
      await expect(fresh.deploymentTransaction())
        .to.emit(fresh, "OwnershipTransferred")
        .withArgs(ethers.ZeroAddress, admin.address);
    });

    it("lets the owner transfer ownership and emits the event", async function () {
      const { registry, admin, stranger } = await loadFixture(deployFixture);
      await expect(registry.transferOwnership(stranger.address))
        .to.emit(registry, "OwnershipTransferred")
        .withArgs(admin.address, stranger.address);
      expect(await registry.owner()).to.equal(stranger.address);
    });

    it("moves admin rights to the new owner and away from the old one", async function () {
      const { registry, admin, stranger, fastrack } = await loadFixture(deployFixture);
      await registry.transferOwnership(stranger.address);
      await expect(registry.verifyBrand(fastrack.address, "Fastrack"))
        .to.be.revertedWithCustomError(registry, "NotOwner")
        .withArgs(admin.address);
      await expect(registry.connect(stranger).verifyBrand(fastrack.address, "Fastrack")).to.not.be.reverted;
    });

    it("rejects transferOwnership from a non-owner", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(registry.connect(stranger).transferOwnership(stranger.address))
        .to.be.revertedWithCustomError(registry, "NotOwner")
        .withArgs(stranger.address);
    });

    it("rejects transferOwnership to the zero address", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress"
      );
    });
  });

  describe("verifyBrand", function () {
    it("[R1] verifies a brand, stores its record and emits BrandVerified", async function () {
      const { registry, fastrack } = await loadFixture(deployFixture);
      await expect(registry.verifyBrand(fastrack.address, "Fastrack"))
        .to.emit(registry, "BrandVerified")
        .withArgs(fastrack.address, "Fastrack");

      const brand = await registry.getBrand(fastrack.address);
      expect(brand.name).to.equal("Fastrack");
      expect(brand.verified).to.equal(true);
      expect(brand.exists).to.equal(true);
      expect(brand.verifiedAt).to.equal(await time.latest());
      expect(await registry.getBrandCount()).to.equal(1n);
    });

    it("[R1] reverts when a non-admin calls it", async function () {
      const { registry, fastrack, stranger } = await loadFixture(deployFixture);
      await expect(registry.connect(stranger).verifyBrand(fastrack.address, "Fastrack"))
        .to.be.revertedWithCustomError(registry, "NotOwner")
        .withArgs(stranger.address);
    });

    it("rejects the zero address", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.verifyBrand(ethers.ZeroAddress, "Fastrack")).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress"
      );
    });

    it("rejects an empty name", async function () {
      const { registry, fastrack } = await loadFixture(deployFixture);
      await expect(registry.verifyBrand(fastrack.address, "")).to.be.revertedWithCustomError(
        registry,
        "EmptyName"
      );
    });

    it("rejects an over-long name but accepts exactly the maximum", async function () {
      const { registry, fastrack, titan } = await loadFixture(deployFixture);
      await expect(registry.verifyBrand(fastrack.address, "x".repeat(101)))
        .to.be.revertedWithCustomError(registry, "NameTooLong")
        .withArgs(101, 100);
      await expect(registry.verifyBrand(titan.address, "x".repeat(100))).to.not.be.reverted;
    });

    it("reverts BrandAlreadyVerified when the brand is already verified", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      await expect(registry.verifyBrand(fastrack.address, "Fastrack"))
        .to.be.revertedWithCustomError(registry, "BrandAlreadyVerified")
        .withArgs(fastrack.address);
    });

    it("allows re-verifying a revoked brand, updates the name, and does not duplicate the list entry", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      await registry.revokeBrand(fastrack.address);
      await expect(registry.verifyBrand(fastrack.address, "Fastrack India"))
        .to.emit(registry, "BrandVerified")
        .withArgs(fastrack.address, "Fastrack India");

      const brand = await registry.getBrand(fastrack.address);
      expect(brand.verified).to.equal(true);
      expect(brand.name).to.equal("Fastrack India");
      expect(await registry.getBrandCount()).to.equal(2n); // Fastrack + Titan, not 3
    });

    it("returns an empty record for an unknown brand", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      const brand = await registry.getBrand(stranger.address);
      expect(brand.exists).to.equal(false);
      expect(brand.verified).to.equal(false);
      expect(brand.name).to.equal("");
    });
  });

  describe("revokeBrand", function () {
    it("[R1] revokes a verified brand and emits BrandRevoked", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      await expect(registry.revokeBrand(fastrack.address)).to.emit(registry, "BrandRevoked").withArgs(fastrack.address);
      const brand = await registry.getBrand(fastrack.address);
      expect(brand.verified).to.equal(false);
      expect(brand.exists).to.equal(true);
    });

    it("[R1] reverts when a non-admin calls it", async function () {
      const { registry, fastrack, stranger } = await loadFixture(brandsFixture);
      await expect(registry.connect(stranger).revokeBrand(fastrack.address))
        .to.be.revertedWithCustomError(registry, "NotOwner")
        .withArgs(stranger.address);
    });

    it("reverts when the brand is not verified (unknown wallet)", async function () {
      const { registry, stranger } = await loadFixture(brandsFixture);
      await expect(registry.revokeBrand(stranger.address))
        .to.be.revertedWithCustomError(registry, "BrandNotVerified")
        .withArgs(stranger.address);
    });

    it("reverts when the brand was already revoked", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      await registry.revokeBrand(fastrack.address);
      await expect(registry.revokeBrand(fastrack.address))
        .to.be.revertedWithCustomError(registry, "BrandNotVerified")
        .withArgs(fastrack.address);
    });

    it("[R3] a revoked brand cannot register, update, change status, or authorize/revoke sellers", async function () {
      const { registry, fastrack, retailNet, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).authorizeSeller(productId, retailNet.address);
      await registry.revokeBrand(fastrack.address);
      const asBrand = registry.connect(fastrack);
      const notVerified = [registry, "BrandNotVerified"];

      await expect(asBrand.registerProduct("NEW-SKU", "New", DETAILS_V1))
        .to.be.revertedWithCustomError(...notVerified)
        .withArgs(fastrack.address);
      await expect(asBrand.updateProductDetails(productId, DETAILS_V2))
        .to.be.revertedWithCustomError(...notVerified)
        .withArgs(fastrack.address);
      await expect(asBrand.setProductActive(productId, false))
        .to.be.revertedWithCustomError(...notVerified)
        .withArgs(fastrack.address);
      await expect(asBrand.authorizeSeller(productId, ethers.Wallet.createRandom().address))
        .to.be.revertedWithCustomError(...notVerified)
        .withArgs(fastrack.address);
      await expect(asBrand.revokeSeller(productId, retailNet.address))
        .to.be.revertedWithCustomError(...notVerified)
        .withArgs(fastrack.address);
    });
  });

  describe("registerProduct", function () {
    it("[R2] registers a product, stores it active, pushes version 1 and emits both events", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      const expectedId = await registry.computeProductId(fastrack.address, SKU);

      await expect(registry.connect(fastrack).registerProduct(SKU, NAME, DETAILS_V1))
        .to.emit(registry, "ProductRegistered")
        .withArgs(expectedId, fastrack.address, SKU, NAME)
        .and.to.emit(registry, "VersionAdded")
        .withArgs(expectedId, 1, hashOf(DETAILS_V1));

      const product = await registry.getProduct(expectedId);
      expect(product.brand).to.equal(fastrack.address);
      expect(product.sku).to.equal(SKU);
      expect(product.name).to.equal(NAME);
      expect(product.active).to.equal(true);
      expect(product.exists).to.equal(true);
      expect(product.createdAt).to.equal(await time.latest());
      expect(await registry.getVersionCount(expectedId)).to.equal(1n);
      expect(await registry.productStatus(expectedId)).to.equal(3n); // VALID
    });

    it("[R2] returns an ID equal to computeProductId and to keccak256(abi.encode(brand, sku))", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      const viaCall = await registry.connect(fastrack).registerProduct.staticCall(SKU, NAME, DETAILS_V1);
      const manual = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "string"], [fastrack.address, SKU])
      );
      expect(viaCall).to.equal(await registry.computeProductId(fastrack.address, SKU));
      expect(viaCall).to.equal(manual);
    });

    it("[R4] stores version 1 with the correct keccak256 hash of the details", async function () {
      const { registry, productId } = await loadFixture(productFixture);
      const v1 = await registry.getVersion(productId, 1);
      expect(v1.details).to.equal(DETAILS_V1);
      expect(v1.detailsHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(DETAILS_V1)));
      expect(v1.timestamp).to.equal(await time.latest());
    });

    it("[R2] reverts for an unverified caller", async function () {
      const { registry, stranger } = await loadFixture(brandsFixture);
      await expect(registry.connect(stranger).registerProduct(SKU, NAME, DETAILS_V1))
        .to.be.revertedWithCustomError(registry, "BrandNotVerified")
        .withArgs(stranger.address);
    });

    it("[R2] reverts when the same brand registers the same SKU twice", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await expect(registry.connect(fastrack).registerProduct(SKU, "Other name", DETAILS_V2))
        .to.be.revertedWithCustomError(registry, "ProductAlreadyExists")
        .withArgs(productId);
    });

    it("[R2] allows the same SKU under a different brand and gives it a different ID", async function () {
      const { registry, fastrack, titan, productId } = await loadFixture(productFixture);
      await registry.connect(titan).registerProduct(SKU, NAME, DETAILS_V1);
      const titanId = await registry.computeProductId(titan.address, SKU);
      expect(titanId).to.not.equal(productId);
      expect((await registry.getProduct(titanId)).brand).to.equal(titan.address);
      expect((await registry.getProduct(productId)).brand).to.equal(fastrack.address);
    });

    it("rejects empty and over-long SKU, name and details (and accepts the exact maximum)", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      const asBrand = registry.connect(fastrack);

      await expect(asBrand.registerProduct("", NAME, DETAILS_V1)).to.be.revertedWithCustomError(registry, "EmptySku");
      await expect(asBrand.registerProduct("s".repeat(65), NAME, DETAILS_V1))
        .to.be.revertedWithCustomError(registry, "SkuTooLong")
        .withArgs(65, 64);

      await expect(asBrand.registerProduct(SKU, "", DETAILS_V1)).to.be.revertedWithCustomError(registry, "EmptyName");
      await expect(asBrand.registerProduct(SKU, "n".repeat(101), DETAILS_V1))
        .to.be.revertedWithCustomError(registry, "NameTooLong")
        .withArgs(101, 100);

      await expect(asBrand.registerProduct(SKU, NAME, "")).to.be.revertedWithCustomError(registry, "EmptyDetails");
      await expect(asBrand.registerProduct(SKU, NAME, "d".repeat(4097)))
        .to.be.revertedWithCustomError(registry, "DetailsTooLong")
        .withArgs(4097, 4096);

      // Exactly at the limits is fine.
      await expect(asBrand.registerProduct("s".repeat(64), "n".repeat(100), "d".repeat(4096))).to.not.be.reverted;
    });

    it("measures length in bytes, so multi-byte characters count more than once", async function () {
      const { registry, fastrack } = await loadFixture(brandsFixture);
      // 51 two-byte characters = 102 bytes, which is over the 100-byte name limit.
      await expect(registry.connect(fastrack).registerProduct(SKU, "é".repeat(51), DETAILS_V1))
        .to.be.revertedWithCustomError(registry, "NameTooLong")
        .withArgs(102, 100);
    });

    it("lists the product under its brand", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      expect(await registry.getBrandProducts(fastrack.address, 0, 10)).to.deep.equal([productId]);
    });
  });

  describe("getProduct / getLatestVersion on unknown products", function () {
    it("getProduct reverts ProductNotFound", async function () {
      const { registry } = await loadFixture(brandsFixture);
      const unknown = ethers.id("nothing");
      await expect(registry.getProduct(unknown))
        .to.be.revertedWithCustomError(registry, "ProductNotFound")
        .withArgs(unknown);
    });

    it("getLatestVersion reverts ProductNotFound", async function () {
      const { registry } = await loadFixture(brandsFixture);
      const unknown = ethers.id("nothing");
      await expect(registry.getLatestVersion(unknown))
        .to.be.revertedWithCustomError(registry, "ProductNotFound")
        .withArgs(unknown);
    });

    it("getVersionCount is 0 for an unknown product", async function () {
      const { registry } = await loadFixture(brandsFixture);
      expect(await registry.getVersionCount(ethers.id("nothing"))).to.equal(0n);
    });
  });

  describe("updateProductDetails", function () {
    it("[R4] appends version 2 with the right hash, increments the count and emits VersionAdded", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await expect(registry.connect(fastrack).updateProductDetails(productId, DETAILS_V2))
        .to.emit(registry, "VersionAdded")
        .withArgs(productId, 2, hashOf(DETAILS_V2));

      expect(await registry.getVersionCount(productId)).to.equal(2n);
      const v2 = await registry.getVersion(productId, 2);
      expect(v2.details).to.equal(DETAILS_V2);
      expect(v2.detailsHash).to.equal(hashOf(DETAILS_V2));
      expect(v2.timestamp).to.equal(await time.latest());

      const latest = await registry.getLatestVersion(productId);
      expect(latest.details).to.equal(DETAILS_V2);
      expect(latest.detailsHash).to.equal(hashOf(DETAILS_V2));
    });

    it("[R4] leaves the old version unchanged byte-for-byte", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      const before = await registry.getVersion(productId, 1);
      await time.increase(100);
      await registry.connect(fastrack).updateProductDetails(productId, DETAILS_V2);
      const after = await registry.getVersion(productId, 1);

      expect(after.details).to.equal(before.details);
      expect(after.detailsHash).to.equal(before.detailsHash);
      expect(after.timestamp).to.equal(before.timestamp);
      expect(ethers.toUtf8Bytes(after.details)).to.deep.equal(ethers.toUtf8Bytes(DETAILS_V1));
    });

    it("[R4] keeps the full history across several updates", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      const asBrand = registry.connect(fastrack);
      await asBrand.updateProductDetails(productId, DETAILS_V2);
      await asBrand.updateProductDetails(productId, "v3");
      expect(await registry.getVersionCount(productId)).to.equal(3n);
      expect((await registry.getVersion(productId, 1)).details).to.equal(DETAILS_V1);
      expect((await registry.getVersion(productId, 2)).details).to.equal(DETAILS_V2);
      expect((await registry.getVersion(productId, 3)).details).to.equal("v3");
    });

    it("[R5] reverts DetailsUnchanged when the hash equals the latest version", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await expect(registry.connect(fastrack).updateProductDetails(productId, DETAILS_V1))
        .to.be.revertedWithCustomError(registry, "DetailsUnchanged")
        .withArgs(productId);

      // The check is against the LATEST version only: going back to old content is a real change.
      await registry.connect(fastrack).updateProductDetails(productId, DETAILS_V2);
      await expect(registry.connect(fastrack).updateProductDetails(productId, DETAILS_V2))
        .to.be.revertedWithCustomError(registry, "DetailsUnchanged")
        .withArgs(productId);
      await expect(registry.connect(fastrack).updateProductDetails(productId, DETAILS_V1)).to.not.be.reverted;
      expect(await registry.getVersionCount(productId)).to.equal(3n);
    });

    it("[R3] reverts when another verified brand tries to update", async function () {
      const { registry, titan, productId } = await loadFixture(productFixture);
      await expect(registry.connect(titan).updateProductDetails(productId, DETAILS_V2))
        .to.be.revertedWithCustomError(registry, "NotProductBrand")
        .withArgs(productId, titan.address);
    });

    it("reverts for a product that does not exist", async function () {
      const { registry, fastrack } = await loadFixture(productFixture);
      const unknown = ethers.id("nothing");
      await expect(registry.connect(fastrack).updateProductDetails(unknown, DETAILS_V2))
        .to.be.revertedWithCustomError(registry, "ProductNotFound")
        .withArgs(unknown);
    });

    it("reverts when the product is inactive", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).setProductActive(productId, false);
      await expect(registry.connect(fastrack).updateProductDetails(productId, DETAILS_V2))
        .to.be.revertedWithCustomError(registry, "ProductInactive")
        .withArgs(productId);
    });

    it("rejects empty and over-long details", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await expect(registry.connect(fastrack).updateProductDetails(productId, "")).to.be.revertedWithCustomError(
        registry,
        "EmptyDetails"
      );
      await expect(registry.connect(fastrack).updateProductDetails(productId, "d".repeat(4097)))
        .to.be.revertedWithCustomError(registry, "DetailsTooLong")
        .withArgs(4097, 4096);
    });

    it("getVersion(0) and out-of-range versions revert VersionNotFound", async function () {
      const { registry, productId } = await loadFixture(productFixture);
      await expect(registry.getVersion(productId, 0))
        .to.be.revertedWithCustomError(registry, "VersionNotFound")
        .withArgs(productId, 0);
      await expect(registry.getVersion(productId, 2))
        .to.be.revertedWithCustomError(registry, "VersionNotFound")
        .withArgs(productId, 2);
    });
  });

  describe("setProductActive", function () {
    it("[R3] toggles both ways, emits events and is reflected in productStatus", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      const asBrand = registry.connect(fastrack);

      await expect(asBrand.setProductActive(productId, false))
        .to.emit(registry, "ProductStatusChanged")
        .withArgs(productId, false);
      expect((await registry.getProduct(productId)).active).to.equal(false);
      expect(await registry.productStatus(productId)).to.equal(2n); // INACTIVE

      await expect(asBrand.setProductActive(productId, true))
        .to.emit(registry, "ProductStatusChanged")
        .withArgs(productId, true);
      expect((await registry.getProduct(productId)).active).to.equal(true);
      expect(await registry.productStatus(productId)).to.equal(3n); // VALID
    });

    it("reverts StatusUnchanged when the product is already in that state", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await expect(registry.connect(fastrack).setProductActive(productId, true)).to.be.revertedWithCustomError(
        registry,
        "StatusUnchanged"
      );
      await registry.connect(fastrack).setProductActive(productId, false);
      await expect(registry.connect(fastrack).setProductActive(productId, false)).to.be.revertedWithCustomError(
        registry,
        "StatusUnchanged"
      );
    });

    it("[R3] reverts when another brand tries to change the status", async function () {
      const { registry, titan, productId } = await loadFixture(productFixture);
      await expect(registry.connect(titan).setProductActive(productId, false))
        .to.be.revertedWithCustomError(registry, "NotProductBrand")
        .withArgs(productId, titan.address);
    });

    it("[R3] reverts when a stranger (not a brand at all) tries to change the status", async function () {
      const { registry, stranger, productId } = await loadFixture(productFixture);
      await expect(registry.connect(stranger).setProductActive(productId, false))
        .to.be.revertedWithCustomError(registry, "NotProductBrand")
        .withArgs(productId, stranger.address);
    });
  });

  describe("productStatus", function () {
    it("returns NOT_FOUND, BRAND_NOT_VERIFIED, INACTIVE and VALID", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      expect(await registry.productStatus(ethers.id("nothing"))).to.equal(0n); // NOT_FOUND
      expect(await registry.productStatus(productId)).to.equal(3n); // VALID

      await registry.connect(fastrack).setProductActive(productId, false);
      expect(await registry.productStatus(productId)).to.equal(2n); // INACTIVE

      // A revoked brand outranks an inactive product in the check order.
      await registry.revokeBrand(fastrack.address);
      expect(await registry.productStatus(productId)).to.equal(1n); // BRAND_NOT_VERIFIED
    });
  });

  describe("Sellers", function () {
    it("[R3] authorizes a seller and emits SellerAuthorized", async function () {
      const { registry, fastrack, retailNet, productId } = await loadFixture(productFixture);
      expect(await registry.isAuthorizedSeller(productId, retailNet.address)).to.equal(false);
      await expect(registry.connect(fastrack).authorizeSeller(productId, retailNet.address))
        .to.emit(registry, "SellerAuthorized")
        .withArgs(productId, retailNet.address);
      expect(await registry.isAuthorizedSeller(productId, retailNet.address)).to.equal(true);
    });

    it("reverts SellerAlreadyAuthorized on a double authorize", async function () {
      const { registry, fastrack, retailNet, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).authorizeSeller(productId, retailNet.address);
      await expect(registry.connect(fastrack).authorizeSeller(productId, retailNet.address))
        .to.be.revertedWithCustomError(registry, "SellerAlreadyAuthorized")
        .withArgs(productId, retailNet.address);
    });

    it("rejects authorizing the zero address", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await expect(
        registry.connect(fastrack).authorizeSeller(productId, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("lets a brand authorize itself as an official store", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).authorizeSeller(productId, fastrack.address);
      expect(await registry.isAuthorizedSeller(productId, fastrack.address)).to.equal(true);
    });

    it("[R3] revokes a seller and emits SellerRevoked", async function () {
      const { registry, fastrack, retailNet, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).authorizeSeller(productId, retailNet.address);
      await expect(registry.connect(fastrack).revokeSeller(productId, retailNet.address))
        .to.emit(registry, "SellerRevoked")
        .withArgs(productId, retailNet.address);
      expect(await registry.isAuthorizedSeller(productId, retailNet.address)).to.equal(false);
    });

    it("reverts SellerNotAuthorized when revoking a seller that is not authorized", async function () {
      const { registry, fastrack, retailNet, productId } = await loadFixture(productFixture);
      await expect(registry.connect(fastrack).revokeSeller(productId, retailNet.address))
        .to.be.revertedWithCustomError(registry, "SellerNotAuthorized")
        .withArgs(productId, retailNet.address);

      // Also after it was already revoked once.
      await registry.connect(fastrack).authorizeSeller(productId, retailNet.address);
      await registry.connect(fastrack).revokeSeller(productId, retailNet.address);
      await expect(registry.connect(fastrack).revokeSeller(productId, retailNet.address))
        .to.be.revertedWithCustomError(registry, "SellerNotAuthorized")
        .withArgs(productId, retailNet.address);
    });

    it("[R3] reverts when another brand tries to authorize or revoke sellers", async function () {
      const { registry, fastrack, titan, retailNet, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).authorizeSeller(productId, retailNet.address);
      await expect(registry.connect(titan).authorizeSeller(productId, retailNet.address))
        .to.be.revertedWithCustomError(registry, "NotProductBrand")
        .withArgs(productId, titan.address);
      await expect(registry.connect(titan).revokeSeller(productId, retailNet.address))
        .to.be.revertedWithCustomError(registry, "NotProductBrand")
        .withArgs(productId, titan.address);
    });

    it("lets a brand manage sellers even while the product is inactive", async function () {
      const { registry, fastrack, retailNet, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).setProductActive(productId, false);
      await expect(registry.connect(fastrack).authorizeSeller(productId, retailNet.address)).to.not.be.reverted;
      await expect(registry.connect(fastrack).revokeSeller(productId, retailNet.address)).to.not.be.reverted;
    });

    it("getAuthorizedSellers reflects the current state after revoke and re-authorize", async function () {
      const { registry, fastrack, retailNet, quickShop, productId } = await loadFixture(productFixture);
      const asBrand = registry.connect(fastrack);
      expect(await registry.getAuthorizedSellers(productId)).to.deep.equal([]);

      await asBrand.authorizeSeller(productId, retailNet.address);
      await asBrand.authorizeSeller(productId, quickShop.address);
      expect(await registry.getAuthorizedSellers(productId)).to.deep.equal([retailNet.address, quickShop.address]);

      await asBrand.revokeSeller(productId, retailNet.address);
      expect(await registry.getAuthorizedSellers(productId)).to.deep.equal([quickShop.address]);

      // Re-authorizing must not create a duplicate entry.
      await asBrand.authorizeSeller(productId, retailNet.address);
      // Copy to a plain array: ethers returns a read-only Result, which Chai's `members` cannot use.
      const sellers = [...(await registry.getAuthorizedSellers(productId))];
      expect(sellers).to.have.members([retailNet.address, quickShop.address]);
      expect(sellers.length).to.equal(2);
    });
  });

  describe("Pagination", function () {
    it("getBrands respects offset and limit and returns empty at or beyond the end", async function () {
      const { registry, fastrack, titan, stranger } = await loadFixture(brandsFixture);
      await registry.verifyBrand(stranger.address, "Other");
      expect(await registry.getBrandCount()).to.equal(3n);

      expect(await registry.getBrands(0, 10)).to.deep.equal([fastrack.address, titan.address, stranger.address]);
      expect(await registry.getBrands(1, 1)).to.deep.equal([titan.address]);
      expect(await registry.getBrands(2, 5)).to.deep.equal([stranger.address]);
      expect(await registry.getBrands(3, 5)).to.deep.equal([]);
      expect(await registry.getBrands(99, 5)).to.deep.equal([]);
      expect(await registry.getBrands(0, 0)).to.deep.equal([]);
    });

    it("getBrandProducts respects offset and limit and returns empty at or beyond the end", async function () {
      const { registry, fastrack, productId } = await loadFixture(productFixture);
      await registry.connect(fastrack).registerProduct("SKU-2", "Two", DETAILS_V1);
      await registry.connect(fastrack).registerProduct("SKU-3", "Three", DETAILS_V1);
      const id2 = await registry.computeProductId(fastrack.address, "SKU-2");
      const id3 = await registry.computeProductId(fastrack.address, "SKU-3");

      expect(await registry.getBrandProducts(fastrack.address, 0, 10)).to.deep.equal([productId, id2, id3]);
      expect(await registry.getBrandProducts(fastrack.address, 1, 1)).to.deep.equal([id2]);
      expect(await registry.getBrandProducts(fastrack.address, 2, 10)).to.deep.equal([id3]);
      expect(await registry.getBrandProducts(fastrack.address, 3, 10)).to.deep.equal([]);
      expect(await registry.getBrandProducts(fastrack.address, 50, 10)).to.deep.equal([]);
    });

    it("getBrandProducts returns empty for a wallet with no products", async function () {
      const { registry, stranger } = await loadFixture(productFixture);
      expect(await registry.getBrandProducts(stranger.address, 0, 10)).to.deep.equal([]);
    });
  });

  describe("ETH handling", function () {
    it("reverts when ETH is sent to the contract (no receive/fallback)", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      await expect(admin.sendTransaction({ to: await registry.getAddress(), value: 1n })).to.be.reverted;
    });

    it("reverts when ETH is sent along with calldata that matches no function", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      await expect(admin.sendTransaction({ to: await registry.getAddress(), value: 1n, data: "0x12345678" })).to.be
        .reverted;
    });

    it("reverts when ETH is attached to a normal call (functions are not payable)", async function () {
      const { registry, fastrack } = await loadFixture(deployFixture);
      await expect(registry.verifyBrand(fastrack.address, "Fastrack", { value: 1n })).to.be.reverted;
    });
  });
});
