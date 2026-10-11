// Top-right controls: network indicator and the account switcher (demo mode) or wallet connect (MetaMask mode).
import { useChain } from "../context/chainState.js";
import { accountLabel } from "../lib/format.js";
import { Address } from "./ui.jsx";

export function AccountBar() {
  const { mode, deployment, chainId, accounts, account, selectAccount, connectWallet, canSwitchMode, switchMode } =
    useChain();

  return (
    <div className="account-bar">
      <p className="network" title={`Chain id ${chainId}`}>
        <span className="network-dot" aria-hidden="true" />
        {deployment.network} · chain {chainId}
      </p>

      {mode === "demo" ? (
        <div className="account-switch">
          <label htmlFor="account-select">Acting as</label>
          <select id="account-select" value={account ?? ""} onChange={(event) => selectAccount(event.target.value)}>
            {accounts.map((a) => (
              <option key={a.address} value={a.address}>
                {accountLabel(a)}
              </option>
            ))}
          </select>
          {account && <Address value={account} />}
        </div>
      ) : account ? (
        <div className="account-switch">
          <span className="account-label">Wallet</span>
          <Address value={account} />
        </div>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => connectWallet().catch(() => {})}>
          Connect wallet
        </button>
      )}

      {canSwitchMode && (
        <button type="button" className="btn btn-quiet" onClick={() => switchMode(mode === "demo" ? "metamask" : "demo")}>
          {mode === "demo" ? "Use MetaMask instead" : "Use demo accounts instead"}
        </button>
      )}
    </div>
  );
}
