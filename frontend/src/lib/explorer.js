// Links to a block explorer (Etherscan) for public networks.
// A local Hardhat chain has no explorer, so every function here returns null for it and the interface
// simply shows plain text. Kept free of imports so the deploy scripts and a test can reuse it.

/** Chain id -> explorer address. Add a line here to support another network. */
const EXPLORERS = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
};

const PATTERNS = {
  tx: /^0x[0-9a-fA-F]{64}$/, // a transaction hash
  address: /^0x[0-9a-fA-F]{40}$/, // a wallet or contract address
};

/** The explorer's base address for a chain, or null when the chain has none (for example a local chain). */
export const explorerBase = (chainId) => EXPLORERS[Number(chainId)] ?? null;

/**
 * Link to a transaction or an address on the explorer.
 * @param {number | string | bigint} chainId The chain the value lives on.
 * @param {"tx" | "address"} kind What the value is.
 * @param {string} value The transaction hash or the address.
 * @returns {string | null} The link, or null if there is no explorer or the value does not look right.
 */
export function explorerUrl(chainId, kind, value) {
  const base = explorerBase(chainId);
  const pattern = PATTERNS[kind];
  if (!base || !pattern || typeof value !== "string" || !pattern.test(value)) return null;
  return `${base}/${kind}/${value}`;
}

/** Link to the verified source code of a contract (the "Contract" tab on Etherscan). */
export function explorerCodeUrl(chainId, address) {
  const url = explorerUrl(chainId, "address", address);
  return url ? `${url}#code` : null;
}
