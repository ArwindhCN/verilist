// Loads the two files the deploy and seed scripts write into src/contracts/.
// `import.meta.glob` is used instead of a plain import so the app still builds and starts
// when the files do not exist yet (before the first deploy). A missing file just gives `null`,
// and the app then shows the setup screen instead of a blank page.
const files = import.meta.glob("../contracts/*.json", { eager: true, import: "default" });

/** Output of `npm run deploy:local` or `npm run deploy:sepolia`, or null if not deployed yet. */
export const deployment = files["../contracts/deployment.json"] ?? null;

/** Output of `npm run seed:local`: role name -> { address, index, role }, or null. */
export const demoAccounts = files["../contracts/demo-accounts.json"] ?? null;

/**
 * Optional nicknames for addresses (for example sellers): { "RetailNet": "0x1234..." }.
 * Local file, never needed. See lib/addressNames.js.
 */
export const addressNames = files["../contracts/address-names.json"] ?? null;

/** The local Hardhat node started by `npm run node`. */
export const LOCAL_RPC_URL = "http://127.0.0.1:8545";

/** Hardhat's built-in chain id. A deployment with this id runs in "local demo mode". */
export const LOCAL_CHAIN_ID = 31337;
