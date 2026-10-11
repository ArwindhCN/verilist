// Small display helpers.

/** 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 -> 0x7099…79C8 */
export function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** "Fastrack (brand)", but just "Admin" when the name already is the role. */
export function accountLabel(account) {
  return account.role && account.role.toLowerCase() !== account.name.toLowerCase()
    ? `${account.name} (${account.role})`
    : account.name;
}

/** Shortens any 0x hash the same way. */
export const shortHash = (hash) => (hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "");

/** Seconds since epoch (bigint or number) -> "5 Oct 2026, 21:30". */
export function formatTimestamp(seconds) {
  if (seconds === undefined || seconds === null) return "";
  const date = new Date(Number(seconds) * 1000);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Seconds since epoch -> "21:30:05" (used in the activity feed). */
export function formatClock(seconds) {
  return new Date(Number(seconds) * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** 2995 -> "₹2,995" */
export const formatInr = (value) => inr.format(Number(value));

/** Number of UTF-8 bytes in a string. The contract limits are in bytes, not characters. */
export const byteLength = (text) => new TextEncoder().encode(text).length;

/** Reads a value from localStorage without ever throwing (it can be blocked in private windows). */
export function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes to localStorage without ever throwing. */
export function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore: remembering the choice is only a convenience.
  }
}
