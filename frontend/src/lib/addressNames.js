// Friendly names for addresses the blockchain does not name, for example sellers.
// The contracts store names only for brands and marketplaces, so a seller such as RetailNet is just an address.
// An optional local file, frontend/src/contracts/address-names.json, can give any address a nickname that this
// website shows instead of the short address:   { "RetailNet": "0x1234...", "FakeDeals": "0x5678..." }
// It only changes what THIS website displays. Nothing is written to the blockchain.
//
// Names can also be typed into the website itself (the "Name this address" box next to a seller picker). Those are
// kept in this browser's localStorage and win over the file. The helpers for that are at the bottom of this file.
import { getAddress } from "ethers";

/** The longest in-app name we keep, so one name cannot stretch the layout. */
export const MAX_NAME_LENGTH = 30;

/** Any address spelling (lowercase, padded, a wrong capital letter) -> checksum form, or null if it is not an address. */
function toChecksum(value) {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value.trim().toLowerCase());
  } catch {
    return null;
  }
}

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
    const address = toChecksum(value);
    if (!label || !address) continue;
    if (seen.has(address)) continue; // the first name given to an address wins
    seen.add(address);
    out.push({ name: label, address });
  }
  return out;
}

/** A name typed into the website: one line of text, extra spaces removed, at most MAX_NAME_LENGTH long. */
function cleanName(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) : "";
}

/** Reads the names saved in this browser (JSON text { "<address>": "<name>" }). Anything unreadable is skipped. */
export function parseSavedNames(text) {
  if (typeof text !== "string") return [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const [key, value] of Object.entries(raw)) {
    const address = toChecksum(key);
    const name = cleanName(value);
    if (!address || !name || seen.has(address)) continue;
    seen.add(address);
    out.push({ name, address });
  }
  return out;
}

/** The text to store for a list of saved names. */
export function serializeSavedNames(list) {
  return JSON.stringify(Object.fromEntries(list.map((entry) => [entry.address, entry.name])));
}

/**
 * Returns a new list with `name` saved for `address`: a new address is added, an existing one is renamed in place,
 * and an empty name forgets it. A value that is not an address leaves the list unchanged.
 */
export function withSavedName(list, address, name) {
  const checksum = toChecksum(address);
  if (!checksum) return list;
  const clean = cleanName(name);
  const exists = list.some((entry) => entry.address === checksum);
  if (!clean) return list.filter((entry) => entry.address !== checksum);
  if (exists) return list.map((entry) => (entry.address === checksum ? { name: clean, address: checksum } : entry));
  return [...list, { name: clean, address: checksum }];
}

/** The names from the file plus the names saved in the browser. For the same address, the saved name wins. */
export function mergeAddressNames(fileNames, savedNames) {
  const merged = new Map();
  for (const entry of [...fileNames, ...savedNames]) merged.set(entry.address, entry);
  return [...merged.values()];
}
