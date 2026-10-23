// Tests for how brand and marketplace names are combined (frontend/src/lib/onChainNames.js).
const path = require("path");
const { pathToFileURL } = require("url");
const { expect } = require("chai");

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

describe("On-chain names (frontend/src/lib/onChainNames.js)", function () {
  let onChainNames;
  before(async function () {
    ({ onChainNames } = await import(pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", "onChainNames.js")).href));
  });

  it("names brands and marketplaces by lowercase address", function () {
    const names = onChainNames([{ address: A, name: "Fastrack" }], [{ address: B, name: "Flipkart", active: true }]);
    expect(names.get(A.toLowerCase())).to.equal("Fastrack");
    expect(names.get(B.toLowerCase())).to.equal("Flipkart");
    expect(names.size).to.equal(2);
  });

  it("skips entries with no name", function () {
    expect(onChainNames([{ address: A, name: "" }], [{ address: B, name: "", active: true }]).size).to.equal(0);
  });

  it("a wallet that is both: the marketplace name shows while the marketplace is on", function () {
    const names = onChainNames([{ address: A, name: "Fastrack" }], [{ address: A, name: "Flipkart", active: true }]);
    expect(names.get(A.toLowerCase())).to.equal("Flipkart");
  });

  it("a wallet that is both: once the marketplace is switched off, the brand name shows again", function () {
    const names = onChainNames([{ address: A, name: "Fastrack" }], [{ address: A, name: "Flipkart", active: false }]);
    expect(names.get(A.toLowerCase())).to.equal("Fastrack");
  });

  it("a switched-off marketplace that is not a brand keeps its own name", function () {
    const names = onChainNames([], [{ address: B, name: "Old Shop", active: false }]);
    expect(names.get(B.toLowerCase())).to.equal("Old Shop");
  });
});
