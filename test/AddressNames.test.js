// Tests for the optional address nicknames (frontend/src/lib/addressNames.js).
const path = require("path");
const { pathToFileURL } = require("url");
const { expect } = require("chai");

const RETAILNET = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // a public Hardhat test account
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("Address nicknames (frontend/src/lib/addressNames.js)", function () {
  let normalizeAddressNames;
  before(async function () {
    ({ normalizeAddressNames } = await import(pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", "addressNames.js")).href));
  });

  it("turns a name -> address file into a clean list, in checksum form", function () {
    expect(normalizeAddressNames({ RetailNet: RETAILNET, FakeDeals: OTHER })).to.deep.equal([
      { name: "RetailNet", address: RETAILNET },
      { name: "FakeDeals", address: OTHER },
    ]);
  });

  it("forgives capital letters and spaces: lowercase, uppercase and padded addresses all work", function () {
    expect(normalizeAddressNames({ A: RETAILNET.toLowerCase() })[0].address).to.equal(RETAILNET);
    expect(normalizeAddressNames({ A: "0x" + RETAILNET.slice(2).toUpperCase() })[0].address).to.equal(RETAILNET);
    expect(normalizeAddressNames({ A: `  ${RETAILNET}  ` })[0].address).to.equal(RETAILNET);
    expect(normalizeAddressNames({ "  Spaced Name  ": RETAILNET })[0].name).to.equal("Spaced Name");
  });

  it("forgives a wrong capital letter in a mixed-case address (a bad checksum), because a nickname file is not security-critical", function () {
    // Same address, but one letter changed from F to f: ethers would reject this as a bad checksum.
    const wrongCase = "0x90f79bf6EB2c4f870365E785982E1f101E93b906";
    expect(wrongCase).to.not.equal(RETAILNET);
    expect(wrongCase.toLowerCase()).to.equal(RETAILNET.toLowerCase());
    expect(normalizeAddressNames({ RetailNet: wrongCase })).to.deep.equal([{ name: "RetailNet", address: RETAILNET }]);
  });

  it("skips entries that are not a valid address or have no name, so a typo never breaks the website", function () {
    expect(normalizeAddressNames({ Bad: "0x1234", AlsoBad: "not an address", Number: 42, Empty: "", Null: null })).to.deep.equal([]);
    expect(normalizeAddressNames({ "": RETAILNET, "   ": OTHER })).to.deep.equal([]);
    // one bad entry does not hide the good ones
    expect(normalizeAddressNames({ Bad: "oops", Good: RETAILNET })).to.deep.equal([{ name: "Good", address: RETAILNET }]);
  });

  it("gives an address only one name: the first one wins", function () {
    expect(normalizeAddressNames({ First: RETAILNET, Second: RETAILNET.toLowerCase() })).to.deep.equal([
      { name: "First", address: RETAILNET },
    ]);
  });

  it("returns an empty list for a missing or wrongly shaped file", function () {
    for (const raw of [null, undefined, "text", 5, [], [["A", RETAILNET]]]) expect(normalizeAddressNames(raw)).to.deep.equal([]);
  });
});
