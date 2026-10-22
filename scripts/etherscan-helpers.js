// Small pure helpers for `verify-etherscan.js`, kept separate so they can be tested without a network.
const { getAddress } = require("ethers");

/** Etherscan answers like this when a contract's source is already published. That is a success, not an error. */
const isAlreadyVerified = (error) => /already verified|already been verified/i.test(String(error?.message ?? error));

/** Right after a deployment Etherscan may not have indexed the contract yet. Waiting and retrying fixes it. */
const isNotIndexedYet = (error) =>
  /unable to locate contractcode|has no bytecode|does not have bytecode|not (yet )?(found|indexed)|try again/i.test(
    String(error?.message ?? error)
  );

/** Reads the optional multisig settings from environment variables (same names and defaults as deploy-multisig.js). */
function parseMultisigSettings(env) {
  const owners = (env.MULTISIG_OWNERS || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => getAddress(a)); // throws a clear error for a malformed address
  return {
    owners,
    threshold: Number(env.MULTISIG_THRESHOLD || 2),
    delay: Number(env.MULTISIG_DELAY_SECONDS || 86400),
  };
}

/**
 * The contracts to verify, each with the exact constructor arguments it was deployed with.
 * ProductRegistry takes none, ListingRegistry takes the ProductRegistry address, and the optional AdminMultisig
 * takes its signers, threshold and delay (verification fails if these differ from the real deployment).
 */
function buildTargets(deployment, env = {}) {
  const targets = [
    { name: "ProductRegistry", address: deployment.addresses.ProductRegistry, constructorArguments: [] },
    {
      name: "ListingRegistry",
      address: deployment.addresses.ListingRegistry,
      constructorArguments: [deployment.addresses.ProductRegistry],
    },
  ];
  if (env.MULTISIG_ADDRESS) {
    const { owners, threshold, delay } = parseMultisigSettings(env);
    if (owners.length === 0) {
      throw new Error("MULTISIG_ADDRESS is set, so MULTISIG_OWNERS must list the signers used at deployment.");
    }
    targets.push({
      name: "AdminMultisig",
      address: getAddress(env.MULTISIG_ADDRESS),
      constructorArguments: [owners, threshold, delay],
    });
  }
  return targets;
}

module.exports = { isAlreadyVerified, isNotIndexedYet, parseMultisigSettings, buildTargets };
