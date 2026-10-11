// Checks the frontend's error decoding against the real contracts:
//  1. every custom error in every contract has a friendly message (so the UI never shows a bare
//     "execution reverted"), and the message map has no stale entries;
//  2. real reverts, thrown by real transactions, decode into those messages.
// The frontend files are plain ES modules, so they are loaded with a dynamic import.
const path = require("path");
const { pathToFileURL } = require("url");
const { expect } = require("chai");
const { ethers } = require("hardhat");

const frontendLib = (file) => pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", file)).href;

/** Dummy values for each Solidity type, so every message function can be called. */
function dummyArg(input) {
  if (input.type === "address") return "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  if (input.type === "bytes32") return ethers.id("example");
  if (input.type.startsWith("uint")) return 7n;
  if (input.type === "string") return "example";
  throw new Error(`No dummy value for type ${input.type}`);
}

const ctx = { name: (address) => `<${address.slice(0, 6)}>`, product: () => "<product>" };

describe("Frontend error messages", function () {
  let ERROR_MESSAGES;
  let decodeError;
  let products;
  let listings;
  let errorFragments; // every custom error declared by any contract, de-duplicated by name

  before(async function () {
    ({ ERROR_MESSAGES } = await import(frontendLib("errorMessages.js")));
    ({ decodeError } = await import(frontendLib("errors.js")));

    products = await (await ethers.getContractFactory("ProductRegistry")).deploy();
    listings = await (await ethers.getContractFactory("ListingRegistry")).deploy(await products.getAddress());

    errorFragments = new Map();
    for (const contract of [products, listings]) {
      for (const fragment of contract.interface.fragments) {
        if (fragment.type === "error") errorFragments.set(fragment.name, fragment);
      }
    }
  });

  it("has a friendly message for EVERY custom error in the contracts", function () {
    expect(errorFragments.size).to.be.greaterThan(20); // sanity: we really did collect them
    const missing = [...errorFragments.keys()].filter((name) => typeof ERROR_MESSAGES[name] !== "function");
    expect(missing, `custom errors without a friendly message: ${missing.join(", ")}`).to.deep.equal([]);
  });

  it("has no message for an error that no contract declares (no stale entries)", function () {
    const stale = Object.keys(ERROR_MESSAGES).filter((name) => !errorFragments.has(name));
    expect(stale, `messages for unknown errors: ${stale.join(", ")}`).to.deep.equal([]);
  });

  it("every message is a non-empty sentence that uses its arguments cleanly", function () {
    for (const [name, fragment] of errorFragments) {
      const args = {};
      for (const input of fragment.inputs) args[input.name] = dummyArg(input);
      const message = ERROR_MESSAGES[name](args, ctx);
      expect(message, name).to.be.a("string").and.not.equal("");
      expect(message, name).to.not.match(/undefined|\[object|NaN/);
      expect(message, name).to.not.match(/execution reverted/i);
    }
  });

  describe("decoding real reverts", function () {
    let admin, fastrack, flipkart, fakeDeals, productId;
    const interfaces = () => [products.interface, listings.interface];

    before(async function () {
      [admin, fastrack, flipkart, fakeDeals] = await ethers.getSigners();
      await products.verifyBrand(fastrack.address, "Fastrack");
      await listings.registerMarketplace(flipkart.address, "Flipkart");
      await products.connect(fastrack).registerProduct("SKU-1", "Reflex Pro", "{}");
      productId = await products.computeProductId(fastrack.address, "SKU-1");
    });

    /** Runs a transaction that must fail and returns what the UI would show. */
    async function failure(txPromise) {
      try {
        await txPromise;
      } catch (error) {
        return decodeError(error, interfaces(), {
          name: (address) => (address === fakeDeals.address ? "FakeDeals" : address === fastrack.address ? "Fastrack" : "Someone"),
          product: () => "Reflex Pro",
        });
      }
      throw new Error("expected the transaction to revert");
    }

    it("SellerNotAuthorized -> names the seller and the product", async function () {
      const result = await failure(listings.connect(flipkart).createListing(productId, fakeDeals.address, "F-1"));
      expect(result.errorName).to.equal("SellerNotAuthorized");
      expect(result.message).to.equal("FakeDeals is not authorized by the brand to sell Reflex Pro.");
    });

    it("NotOwner -> says who is not the admin", async function () {
      const result = await failure(products.connect(fakeDeals).verifyBrand(fakeDeals.address, "Evil"));
      expect(result.errorName).to.equal("NotOwner");
      expect(result.message).to.contain("FakeDeals is not the platform admin");
    });

    it("DetailsUnchanged -> asks the brand to edit something", async function () {
      const result = await failure(products.connect(fastrack).updateProductDetails(productId, "{}"));
      expect(result.errorName).to.equal("DetailsUnchanged");
      expect(result.message).to.contain("identical to the latest version");
    });

    it("ProductAlreadyExists -> tells the brand to use another SKU", async function () {
      const result = await failure(products.connect(fastrack).registerProduct("SKU-1", "Again", "{}"));
      expect(result.errorName).to.equal("ProductAlreadyExists");
      expect(result.message).to.contain("Use a different SKU");
    });

    it("DuplicateListing -> includes the existing listing number", async function () {
      await products.connect(fastrack).authorizeSeller(productId, fakeDeals.address);
      await listings.connect(flipkart).createListing(productId, fakeDeals.address, "D-1");
      const result = await failure(listings.connect(flipkart).createListing(productId, fakeDeals.address, "D-2"));
      expect(result.errorName).to.equal("DuplicateListing");
      expect(result.message).to.contain("listing #1");
    });

    it("never returns a bare 'execution reverted' for an undecodable revert", function () {
      const unknown = { data: "0xdeadbeef", shortMessage: "execution reverted" };
      const result = decodeError(unknown, interfaces(), ctx);
      expect(result.message).to.not.equal("execution reverted");
      expect(result.message).to.contain("0xdeadbeef");
    });

    it("decodes Error(string) and Panic reverts", function () {
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const errorString = "0x08c379a0" + coder.encode(["string"], ["No can do"]).slice(2);
      expect(decodeError({ data: errorString }, interfaces(), ctx).message).to.contain("No can do");
      const panic = "0x4e487b71" + coder.encode(["uint256"], [0x11]).slice(2);
      expect(decodeError({ data: panic }, interfaces(), ctx).message).to.contain("internal error");
    });

    it("explains a wallet rejection and missing funds in plain words", function () {
      expect(decodeError({ code: "ACTION_REJECTED" }, interfaces(), ctx).message).to.contain("rejected");
      expect(decodeError({ code: 4001 }, interfaces(), ctx).message).to.contain("rejected");
      expect(decodeError({ code: "INSUFFICIENT_FUNDS" }, interfaces(), ctx).message).to.contain("no funds");
    });
  });
});
