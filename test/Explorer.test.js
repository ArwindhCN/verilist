// Tests for the Etherscan helpers: the link builder used by the website and the deploy script,
// and the pure helpers behind `npm run verify:sepolia`. None of these need a network.
const path = require("path");
const { pathToFileURL } = require("url");
const { expect } = require("chai");
const { ethers } = require("hardhat");

const TX = "0x" + "ab".repeat(32);
const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SEPOLIA = 11155111;

describe("Etherscan links (frontend/src/lib/explorer.js)", function () {
  let explorerBase;
  let explorerUrl;
  let explorerCodeUrl;

  before(async function () {
    ({ explorerBase, explorerUrl, explorerCodeUrl } = await import(
      pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", "explorer.js")).href
    ));
  });

  it("builds Sepolia transaction and address links", function () {
    expect(explorerUrl(SEPOLIA, "tx", TX)).to.equal(`https://sepolia.etherscan.io/tx/${TX}`);
    expect(explorerUrl(SEPOLIA, "address", ADDRESS)).to.equal(`https://sepolia.etherscan.io/address/${ADDRESS}`);
  });

  it("accepts the chain id as a number, a string or a bigint (ethers returns bigint)", function () {
    const expected = `https://sepolia.etherscan.io/tx/${TX}`;
    expect(explorerUrl(11155111, "tx", TX)).to.equal(expected);
    expect(explorerUrl("11155111", "tx", TX)).to.equal(expected);
    expect(explorerUrl(11155111n, "tx", TX)).to.equal(expected);
  });

  it("knows Ethereum mainnet too", function () {
    expect(explorerBase(1)).to.equal("https://etherscan.io");
  });

  it("returns null on a local chain, which has no explorer (so the interface stays plain text)", function () {
    expect(explorerBase(31337)).to.equal(null);
    expect(explorerUrl(31337, "tx", TX)).to.equal(null);
    expect(explorerUrl(31337, "address", ADDRESS)).to.equal(null);
    expect(explorerCodeUrl(31337, ADDRESS)).to.equal(null);
  });

  it("returns null for an unknown chain, an unknown kind, or a value that does not look like a hash/address", function () {
    expect(explorerUrl(999999, "tx", TX)).to.equal(null);
    expect(explorerUrl(SEPOLIA, "block", TX)).to.equal(null);
    expect(explorerUrl(SEPOLIA, "tx", "0x1234")).to.equal(null); // too short for a transaction hash
    expect(explorerUrl(SEPOLIA, "address", TX)).to.equal(null); // a hash is not an address
    expect(explorerUrl(SEPOLIA, "tx", undefined)).to.equal(null);
    expect(explorerUrl(SEPOLIA, "tx", "javascript:alert(1)")).to.equal(null); // never builds a link from odd text
  });

  it("links to the Contract (source code) tab", function () {
    expect(explorerCodeUrl(SEPOLIA, ADDRESS)).to.equal(`https://sepolia.etherscan.io/address/${ADDRESS}#code`);
  });
});

describe("Etherscan verification helpers (scripts/etherscan-helpers.js)", function () {
  const helpers = require("../scripts/etherscan-helpers.js");
  const deployment = {
    addresses: {
      ProductRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      ListingRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    },
  };

  it("treats 'already verified' as success", function () {
    expect(helpers.isAlreadyVerified(new Error("Contract source code already verified"))).to.equal(true);
    expect(helpers.isAlreadyVerified(new Error("The contract has already been verified on Etherscan"))).to.equal(true);
    expect(helpers.isAlreadyVerified(new Error("Invalid API Key"))).to.equal(false);
    expect(helpers.isAlreadyVerified(undefined)).to.equal(false);
  });

  it("recognises 'Etherscan has not indexed it yet' so the script waits and retries, and nothing else", function () {
    expect(helpers.isNotIndexedYet(new Error("Unable to locate ContractCode at 0x123"))).to.equal(true);
    expect(helpers.isNotIndexedYet(new Error("The address has no bytecode"))).to.equal(true);
    expect(helpers.isNotIndexedYet(new Error("Please try again later"))).to.equal(true);
    expect(helpers.isNotIndexedYet(new Error("Invalid API Key"))).to.equal(false);
    expect(helpers.isNotIndexedYet(new Error("Fail - Unable to verify. Constructor arguments mismatch"))).to.equal(false);
  });

  it("verifies ProductRegistry with no constructor arguments and ListingRegistry with the ProductRegistry address", function () {
    const targets = helpers.buildTargets(deployment, {});
    expect(targets).to.deep.equal([
      { name: "ProductRegistry", address: deployment.addresses.ProductRegistry, constructorArguments: [] },
      {
        name: "ListingRegistry",
        address: deployment.addresses.ListingRegistry,
        constructorArguments: [deployment.addresses.ProductRegistry],
      },
    ]);
  });

  it("adds the AdminMultisig only when MULTISIG_ADDRESS is set, with its signers, threshold and delay", function () {
    const [a, b, c] = [1, 2, 3].map(() => ethers.Wallet.createRandom().address);
    const multisig = ethers.Wallet.createRandom().address;
    const targets = helpers.buildTargets(deployment, {
      MULTISIG_ADDRESS: multisig,
      MULTISIG_OWNERS: `${a}, ${b} ,${c}`, // spaces are fine
      MULTISIG_THRESHOLD: "2",
      MULTISIG_DELAY_SECONDS: "3600",
    });
    expect(targets).to.have.length(3);
    expect(targets[2]).to.deep.equal({ name: "AdminMultisig", address: multisig, constructorArguments: [[a, b, c], 2, 3600] });
  });

  it("uses the deploy script's defaults (2 signers needed, 1 day) when they are not given", function () {
    const settings = helpers.parseMultisigSettings({ MULTISIG_OWNERS: ethers.Wallet.createRandom().address });
    expect(settings.threshold).to.equal(2);
    expect(settings.delay).to.equal(86400);
  });

  it("refuses a multisig address without its signers, and a malformed signer address", function () {
    expect(() => helpers.buildTargets(deployment, { MULTISIG_ADDRESS: ethers.Wallet.createRandom().address })).to.throw(
      /MULTISIG_OWNERS/
    );
    expect(() =>
      helpers.buildTargets(deployment, {
        MULTISIG_ADDRESS: ethers.Wallet.createRandom().address,
        MULTISIG_OWNERS: "not-an-address",
      })
    ).to.throw();
  });
});
