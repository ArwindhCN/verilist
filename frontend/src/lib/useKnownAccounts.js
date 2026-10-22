import { useChain } from "../context/chainState.js";
import { accountLabel } from "./format.js";

/**
 * Known accounts for dropdowns: the demo accounts or the connected wallet, plus every nicknamed address (from
 * address-names.json or typed into the website), so a seller like RetailNet can be picked by name instead of pasted.
 */
export function useKnownAccounts({ exclude = [] } = {}) {
  const { accounts, account, labelFor, nicknames } = useChain();
  const base =
    accounts.length > 0
      ? accounts
      : account
        ? [{ name: labelFor(account) ?? "Connected wallet", role: "", address: account }]
        : [];
  const taken = new Set(base.map((a) => a.address.toLowerCase()));
  const nicknamed = nicknames
    .filter((n) => !taken.has(n.address.toLowerCase()))
    .map((n) => ({ name: n.name, role: "", address: n.address }));
  return [...base, ...nicknamed]
    .filter((a) => !exclude.includes(a.role))
    .map((a) => ({ address: a.address, label: accountLabel(a) }));
}
