// A button that sends one transaction and shows its whole life: waiting for the wallet, pending,
// confirmed (with tx hash and block number) or failed (with a decoded, friendly reason).
import { useEffect, useRef, useState } from "react";
import { useChain } from "../context/chainState.js";
import { shortHash } from "../lib/format.js";
import { CopyButton, Icon, Spinner } from "./ui.jsx";

/**
 * @param {object} props
 * @param {() => Promise<import("ethers").ContractTransactionResponse>} props.action Sends the transaction.
 * @param {() => void} [props.onConfirmed] Called after the transaction is mined.
 * @param {boolean} [props.disabled] Disables the button (for example while a form is incomplete).
 * @param {string} [props.disabledReason] Short text explaining why it is disabled.
 * @param {"primary" | "secondary" | "danger"} [props.variant]
 */
export function TxButton({ action, onConfirmed, disabled = false, disabledReason, variant = "primary", children }) {
  const { write, mode, explainError, refresh, reportTx } = useChain();
  const [tx, setTxState] = useState({ status: "idle" });
  const alive = useRef(true);
  const latest = useRef(tx); // the newest status, readable from the unmount cleanup below
  const setTx = (next) => {
    latest.current = next;
    setTxState(next);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // If this button disappears after a transaction finished (for example a revoked seller's row is
      // removed from the list), hand the result to the page-level toast so the confirmation is not lost.
      if (latest.current.status === "confirmed" || latest.current.status === "failed") reportTx(latest.current);
    };
  }, [reportTx]);

  const busy = tx.status === "wallet" || tx.status === "pending";
  const noSigner = !write;
  const blocked = disabled || noSigner;

  async function send() {
    setTx({ status: "wallet" });
    try {
      const response = await action();
      if (alive.current) setTx({ status: "pending", hash: response.hash });
      const receipt = await response.wait();
      if (alive.current) setTx({ status: "confirmed", hash: receipt.hash, block: receipt.blockNumber });
      refresh();
      onConfirmed?.(receipt);
    } catch (error) {
      if (alive.current) setTx({ status: "failed", message: explainError(error).message });
    }
  }

  const reason = noSigner
    ? mode === "metamask"
      ? "Connect your wallet first."
      : "No account selected."
    : disabled
      ? disabledReason
      : null;

  return (
    <span className="tx">
      <button
        type="button"
        className={`btn btn-${variant}`}
        onClick={send}
        disabled={blocked || busy}
        title={reason ?? undefined}
      >
        {busy && <Spinner />}
        {children}
      </button>
      {blocked && reason && !busy && <span className="tx-hint">{reason}</span>}
      <span className="tx-status" role="status" aria-live="polite">
        {tx.status === "wallet" && <span className="tx-pending">{mode === "metamask" ? "Waiting for your wallet…" : "Sending…"}</span>}
        {tx.status === "pending" && <span className="tx-pending">Pending · tx {shortHash(tx.hash)}</span>}
        {tx.status === "confirmed" && (
          <span className="tx-ok">
            <Icon name="check" size={14} /> Confirmed in block {tx.block} · tx <code className="mono">{shortHash(tx.hash)}</code>
            <CopyButton text={tx.hash} label="Copy transaction hash" />
          </span>
        )}
        {tx.status === "failed" && (
          <span className="tx-failed">
            <Icon name="cross" size={14} /> {tx.message}
          </span>
        )}
      </span>
    </span>
  );
}
