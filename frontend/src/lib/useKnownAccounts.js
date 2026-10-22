import { useChain } from "../context/chainState.js";
import { addressNames } from "./config.js";
import { normalizeAddressNames } from "./addressNames.js";
import { accountLabel } from "./format.js";

/**
 * Known accounts for dropdowns: the demo accounts, or in MetaMask mode the connected wallet plus any nicknamed
 * addresses from address-names.json (so a seller like RetailNet can be picked by name instead of pasted).
 */
export function useKnownAccounts({ exclude = [] } = {}) {
  const { accounts, account, labelFor } = useChain();
  const connected = account ? [{ name: labelFor(account) ?? "Connected wallet", role: "", address: account }] : [];
  const nicknamed = normalizeAddressNames(addressNames)
    .filter((n) => n.address.toLowerCase() !== account?.toLowerCase())
    .map((n) => ({ name: n.name, role: "", address: n.address }));
  const list = accounts.length > 0 ? accounts : [...connected, ...nicknamed];
  return list
    .filter((a) => !exclude.includes(a.role))
    .map((a) => ({ address: a.address, label: accountLabel(a) }));
}
