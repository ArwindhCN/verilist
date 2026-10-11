import { useChain } from "../context/chainState.js";
import { accountLabel } from "./format.js";

/** Known accounts for dropdowns: the demo accounts, or just the connected wallet in MetaMask mode. */
export function useKnownAccounts({ exclude = [] } = {}) {
  const { accounts, account, labelFor } = useChain();
  const list = accounts.length > 0 ? accounts : account ? [{ name: labelFor(account) ?? "Connected wallet", role: "", address: account }] : [];
  return list
    .filter((a) => !exclude.includes(a.role))
    .map((a) => ({ address: a.address, label: accountLabel(a) }));
}
