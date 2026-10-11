// Turns anything a failed transaction can throw into one friendly sentence.
// The important case is a contract revert: the node returns the custom error as raw bytes, which we
// decode with `interface.parseError` and then look up in ERROR_MESSAGES. A raw "execution reverted"
// is never shown on its own.
import { ERROR_MESSAGES } from "./errorMessages.js";

const HEX_REVERT = /^0x[0-9a-fA-F]{8,}$/;

/**
 * Walks the error object looking for revert data. Wallets and nodes nest it in different places
 * (`data`, `error.data`, `info.error.data`, ...), so we search the usual containers.
 */
function findRevertData(error) {
  const found = [];
  const seen = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
    seen.add(value);
    for (const key of ["data", "error", "info", "cause", "originalError", "revert"]) {
      const next = value[key];
      if (typeof next === "string" && key === "data" && HEX_REVERT.test(next)) found.push(next);
      else visit(next, depth + 1);
    }
  };
  visit(error, 0);
  return found;
}

/** True when the user closed or rejected the wallet popup. */
function isUserRejection(error) {
  return (
    error?.code === "ACTION_REJECTED" ||
    error?.code === 4001 ||
    error?.info?.error?.code === 4001 ||
    error?.error?.code === 4001
  );
}

/**
 * @param {unknown} error The thrown error.
 * @param {import("ethers").Interface[]} interfaces Contract interfaces that may declare the custom error.
 * @param {{name: (address: string) => string, product: (id: string) => string}} ctx Name helpers.
 * @returns {{message: string, errorName: string | null}}
 */
export function decodeError(error, interfaces, ctx) {
  if (isUserRejection(error)) {
    return { message: "You rejected the request in your wallet. Nothing was sent.", errorName: null };
  }
  if (error?.code === "INSUFFICIENT_FUNDS") {
    return { message: "This account has no funds to pay the network fee. Add some test ETH and try again.", errorName: null };
  }

  for (const data of findRevertData(error)) {
    // 1. Anything an ethers Interface can decode: our own custom errors, plus the two built-in kinds
    //    Error(string) (a require message) and Panic(uint256) (an internal error such as an overflow).
    for (const iface of interfaces) {
      let parsed = null;
      try {
        parsed = iface.parseError(data);
      } catch {
        parsed = null;
      }
      if (!parsed) continue;

      if (parsed.name === "Error") {
        return { message: `The contract rejected this action: ${parsed.args[0]}`, errorName: "Error" };
      }
      if (parsed.name === "Panic") {
        return { message: "The contract hit an internal error (panic) while running this action.", errorName: "Panic" };
      }

      const args = {};
      parsed.fragment.inputs.forEach((input, i) => {
        args[input.name] = parsed.args[i];
      });
      const make = ERROR_MESSAGES[parsed.name];
      const message = make
        ? make(args, ctx)
        : `The contract rejected this action (${parsed.name}). This error has no friendly message yet.`;
      return { message, errorName: parsed.name };
    }

    // 2. Revert data that no interface recognises.
    return {
      message: `The contract rejected this action with an error we do not recognise (${data.slice(0, 10)}).`,
      errorName: null,
    };
  }

  if (["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT"].includes(error?.code)) {
    return {
      message: "Could not reach the blockchain node. Is `npm run node` still running?",
      errorName: null,
    };
  }

  const raw = String(error?.shortMessage ?? error?.reason ?? error?.message ?? "Unknown error").split("\n")[0];
  return { message: `The transaction could not be sent: ${raw}`, errorName: null };
}
