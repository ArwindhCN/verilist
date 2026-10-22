// Tests for the optional address nicknames (frontend/src/lib/addressNames.js).
const path = require("path");
const { pathToFileURL } = require("url");
const { expect } = require("chai");

const RETAILNET = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // a public Hardhat test account
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const THIRD = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"; // another public Hardhat test account

describe("Address nicknames (frontend/src/lib/addressNames.js)", function () {
  let normalizeAddressNames;
  let parseSavedNames;
  let serializeSavedNames;
  let withSavedName;
  let mergeAddressNames;
  let MAX_NAME_LENGTH;
  before(async function () {
    ({ normalizeAddressNames, parseSavedNames, serializeSavedNames, withSavedName, mergeAddressNames, MAX_NAME_LENGTH } = await import(pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", "addressNames.js")).href));
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

  describe("names typed into the website (saved in the browser)", function () {
    it("reads the saved text back into a clean list, in checksum form", function () {
      const text = JSON.stringify({ [RETAILNET.toLowerCase()]: "RetailNet", [OTHER]: "  Fake   Deals " });
      expect(parseSavedNames(text)).to.deep.equal([
        { name: "RetailNet", address: RETAILNET },
        { name: "Fake Deals", address: OTHER },
      ]);
    });

    it("returns an empty list for nothing, broken text, or the wrong shape (a cleared or damaged browser store)", function () {
      for (const text of [null, undefined, "", "not json", "5", "null", "[]", '["a"]', 42]) expect(parseSavedNames(text)).to.deep.equal([]);
    });

    it("skips entries with a bad address or an empty or non-text name, but keeps the good ones", function () {
      const text = JSON.stringify({ "0x1234": "Short", [RETAILNET]: "", [OTHER]: 7, [THIRD]: "Good" });
      expect(parseSavedNames(text)).to.deep.equal([{ name: "Good", address: THIRD }]);
    });

    it("keeps one name per address when the saved text lists the same address twice in different capitals", function () {
      const text = JSON.stringify({ [RETAILNET]: "First", [RETAILNET.toLowerCase()]: "Second" });
      expect(parseSavedNames(text)).to.deep.equal([{ name: "First", address: RETAILNET }]);
    });

    it("cuts a very long name to the maximum length", function () {
      const [entry] = parseSavedNames(JSON.stringify({ [RETAILNET]: "x".repeat(MAX_NAME_LENGTH + 20) }));
      expect(entry.name).to.equal("x".repeat(MAX_NAME_LENGTH));
    });

    it("saves what it stores: serialize then parse gives the same list", function () {
      const list = [
        { name: "RetailNet", address: RETAILNET },
        { name: "FakeDeals", address: OTHER },
      ];
      expect(parseSavedNames(serializeSavedNames(list))).to.deep.equal(list);
      expect(parseSavedNames(serializeSavedNames([]))).to.deep.equal([]);
    });

    it("adds a new name at the end and cleans it", function () {
      const list = [{ name: "RetailNet", address: RETAILNET }];
      expect(withSavedName(list, OTHER.toLowerCase(), "  Fake   Deals ")).to.deep.equal([
        { name: "RetailNet", address: RETAILNET },
        { name: "Fake Deals", address: OTHER },
      ]);
    });

    it("renames an address in place instead of adding a second entry, whatever capitals the address is typed in", function () {
      const list = [
        { name: "RetailNet", address: RETAILNET },
        { name: "Fake", address: OTHER },
      ];
      expect(withSavedName(list, OTHER.toLowerCase(), "FakeDeals")).to.deep.equal([
        { name: "RetailNet", address: RETAILNET },
        { name: "FakeDeals", address: OTHER },
      ]);
    });

    it("forgets an address when the new name is empty", function () {
      const list = [
        { name: "RetailNet", address: RETAILNET },
        { name: "FakeDeals", address: OTHER },
      ];
      expect(withSavedName(list, OTHER, "   ")).to.deep.equal([{ name: "RetailNet", address: RETAILNET }]);
      expect(withSavedName(list, OTHER, "")).to.have.length(1);
    });

    it("ignores a value that is not an address, and never changes the list it was given", function () {
      const list = Object.freeze([Object.freeze({ name: "RetailNet", address: RETAILNET })]);
      expect(withSavedName(list, "0x1234", "Nope")).to.equal(list);
      expect(withSavedName(list, undefined, "Nope")).to.equal(list);
      withSavedName(list, OTHER, "FakeDeals"); // would throw on a frozen array if it modified the input
      expect(list).to.have.length(1);
    });

    it("merges the file names and the saved names: the saved name wins for the same address", function () {
      const fromFile = [
        { name: "RetailNet (file)", address: RETAILNET },
        { name: "Only in file", address: THIRD },
      ];
      const saved = [
        { name: "RetailNet", address: RETAILNET },
        { name: "FakeDeals", address: OTHER },
      ];
      const merged = mergeAddressNames(fromFile, saved);
      expect(merged.map((e) => e.name)).to.deep.equal(["RetailNet", "Only in file", "FakeDeals"]);
      expect(merged.find((e) => e.address === RETAILNET).name).to.equal("RetailNet");
      expect(mergeAddressNames([], [])).to.deep.equal([]);
      expect(mergeAddressNames(fromFile, [])).to.deep.equal(fromFile);
    });
  });
});
