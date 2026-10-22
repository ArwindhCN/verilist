// Friendly names for addresses the blockchain does not name, for example sellers.
// The contracts store names only for brands and marketplaces, so a seller such as RetailNet is just an address.
// An optional local file, frontend/src/contracts/address-names.json, can give any address a nickname that this
// website shows instead of the short address:   { "RetailNet": "0x1234...", "FakeDeals": "0x5678..." }
// It only changes what THIS website displays. Nothing is written to the blockchain.
import { getAddress } from "ethers";

/**
 * Cleans the raw contents of address-names.json into a list of { name, address }.
 * Entries that are not a text name plus a valid address are skipped, so a typo never breaks the website.
 * Addresses are read case-insensitively (a wrong capital letter is forgiven) and returned in checksum form.
 */
export function normalizeAddressNames(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const [name, value] of Object.entries(raw)) {
    const label = String(name).trim();
    if (!label || typeof value !== "string") continue;
    let address;
    try {
      address = getAddress(value.trim().toLowerCase());
    } catch {
      continue;
    }
    if (seen.has(address)) continue; // the first name given to an address wins
    seen.add(address);
    out.push({ name: label, address });
  }
  return out;
}
