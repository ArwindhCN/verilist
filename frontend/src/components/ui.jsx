// Small building blocks used across the views: icons, the verdict seal, copy button,
// address display, badges and the "you cannot do this with this account" notice.
import { useEffect, useRef, useState } from "react";
import { useChain } from "../context/chainState.js";
import { explorerUrl } from "../lib/explorer.js";
import { shortAddress, shortHash } from "../lib/format.js";
import { STATUS_LABEL, statusTone } from "../lib/status.js";

const ICON_PATHS = {
  check: <path d="M3 8.5l3.2 3.2L13 4.8" />,
  cross: <path d="M4 4l8 8M12 4l-8 8" />,
  warn: (
    <>
      <path d="M8 2.2l6.2 11H1.8z" />
      <path d="M8 6.4v3.2M8 11.6v.1" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M10.5 5.5V3.7a1.2 1.2 0 0 0-1.2-1.2H3.7a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8" />
    </>
  ),
  dash: <path d="M4 8h8" />,
};

/** Decorative icon. It always sits next to text, so it is hidden from screen readers. */
export function Icon({ name, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// Points of the scalloped edge of the seal, worked out once.
const SEAL_EDGE = Array.from({ length: 48 }, (_, i) => {
  const radius = i % 2 === 0 ? 47 : 42;
  const angle = (i * Math.PI) / 24;
  return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(" ");

/** The round seal on the verdict panel: a tick for genuine, a cross for not genuine. */
export function Seal({ ok, size = 88 }) {
  return (
    <svg className="seal" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <polygon points={SEAL_EDGE} fill="currentColor" opacity="0.14" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path
        d={ok ? "M34 51l11 11 21-24" : "M37 37l26 26M63 37L37 63"}
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Small round spinner. The animation stops for people who prefer reduced motion (see CSS). */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** Copies text to the clipboard and briefly shows a tick. */
export function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can be blocked (for example on plain http). Fall back to a hidden textarea.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(area);
      }
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="icon-btn" onClick={copy} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
      <Icon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}

/** An address shown as: role name (if known), shortened address, copy button. */
export function Address({ value }) {
  const { labelFor } = useChain();
  if (!value) return null;
  const label = labelFor(value);
  return (
    <span className="addr">
      {label && <span className="addr-name">{label}</span>}
      <code className="mono" title={value}>
        {shortAddress(value)}
      </code>
      <CopyButton text={value} label={`Copy address${label ? ` of ${label}` : ""}`} />
    </span>
  );
}

/**
 * A transaction hash, shortened. On a public network (Sepolia, mainnet) it is a link to the transaction on
 * Etherscan; on a local chain, which has no explorer, it stays plain text.
 */
export function TxLink({ hash }) {
  const { deployment } = useChain();
  const url = explorerUrl(deployment?.chainId, "tx", hash);
  if (!url) return <code className="mono">{shortHash(hash)}</code>;
  return (
    <a className="ext-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={`View transaction ${shortHash(hash)} on Etherscan (opens in a new tab)`}>
      <code className="mono">{shortHash(hash)}</code> ↗
    </a>
  );
}

/** A hash shown shortened, with the full value on hover and a copy button. */
export function Hash({ value, full = false }) {
  if (!value) return null;
  return (
    <span className="hash">
      <code className="mono" title={value}>
        {full ? value : `${value.slice(0, 10)}…${value.slice(-8)}`}
      </code>
      <CopyButton text={value} label="Copy hash" />
    </span>
  );
}

/** A coloured pill. Always contains text, never only a colour. */
export function Badge({ tone = "neutral", icon, children }) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

/** Badge for a ListingStatus value. */
export function StatusBadge({ status }) {
  const tone = statusTone(status);
  return (
    <Badge tone={tone} icon={tone === "ok" ? "check" : "cross"}>
      {STATUS_LABEL[Number(status)] ?? "Unknown"}
    </Badge>
  );
}

/** Active / inactive style badge for a yes-or-no state. */
export function ActiveBadge({ active, yes = "Active", no = "Inactive" }) {
  return active ? (
    <Badge tone="ok" icon="check">
      {yes}
    </Badge>
  ) : (
    <Badge tone="bad" icon="cross">
      {no}
    </Badge>
  );
}

/** Explains why the current account cannot use a tab, and what to do instead. */
export function RoleNotice({ title, children }) {
  return (
    <div className="notice" role="note">
      <span className="notice-icon">
        <Icon name="warn" size={18} />
      </span>
      <div>
        <p className="notice-title">{title}</p>
        <p className="notice-body">{children}</p>
      </div>
    </div>
  );
}

/** Message shown while data is loading or when nothing exists yet. */
export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

/** Page-level message for a transaction whose own button was removed from the page before you could read it. */
export function TxToast({ tx, onDismiss }) {
  if (!tx) return null;
  const ok = tx.status === "confirmed";
  return (
    <div className={`toast ${ok ? "toast-ok" : "toast-bad"}`} role="status" aria-live="polite">
      <Icon name={ok ? "check" : "cross"} size={16} />
      <p>
        {ok ? (
          <>
            Last transaction confirmed in block {tx.block} · tx <TxLink hash={tx.hash} />
          </>
        ) : (
          tx.message
        )}
      </p>
      {ok && <CopyButton text={tx.hash} label="Copy transaction hash" />}
      <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss message">
        <Icon name="cross" size={14} />
      </button>
    </div>
  );
}
