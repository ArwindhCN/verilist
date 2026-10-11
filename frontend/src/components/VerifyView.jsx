// The public Verify view: type a listing number and see, live from the chain, whether it is genuine.
import { useEffect, useState } from "react";
import { useChain } from "../context/chainState.js";
import { hashDetails, loadListingRows, loadVerification } from "../lib/chain.js";
import { formatTimestamp } from "../lib/format.js";
import { ListingStatus, VERDICT_REASON } from "../lib/status.js";
import { DetailsView, VersionHistory } from "./DetailsView.jsx";
import { Address, Empty, Hash, Icon, Seal, StatusBadge } from "./ui.jsx";

const RECENT_COUNT = 8;

export function VerifyView({ listingId, onSelect }) {
  const { read, provider, refreshKey, explainError } = useChain();
  const [input, setInput] = useState(listingId ?? "");
  const [inputError, setInputError] = useState(null);
  const [result, setResult] = useState({ state: "idle" });
  const [recent, setRecent] = useState(null);

  // Keep the text box in step with the address bar (for example after clicking a recent listing).
  useEffect(() => setInput(listingId ?? ""), [listingId]);

  // Load the verification for the selected listing. Re-runs after any chain change (refreshKey),
  // so a revoke or update made elsewhere shows up here without pressing anything.
  useEffect(() => {
    if (!read || !listingId) {
      setResult({ state: "idle" });
      return undefined;
    }
    let cancelled = false;
    // Keep showing the old result while refreshing the same listing, so the page does not flicker.
    setResult((previous) => (previous.state === "ready" && previous.id === listingId ? previous : { state: "loading" }));
    loadVerification(BigInt(listingId), { provider, products: read.products, listings: read.listings })
      .then((data) => {
        if (!cancelled) setResult({ state: "ready", id: listingId, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ state: "error", message: explainError(error).message });
      });
    return () => {
      cancelled = true;
    };
    // explainError is left out on purpose: it only changes when names load, and must not refetch.
  }, [read, provider, listingId, refreshKey]);

  // The most recent listings, newest first, each with its live status.
  useEffect(() => {
    if (!read) return undefined;
    let cancelled = false;
    (async () => {
      const count = Number(await read.listings.getListingCount());
      const ids = [];
      for (let id = count; id >= 1 && ids.length < RECENT_COUNT; id--) ids.push(id);
      const rows = await loadListingRows(ids, read);
      if (!cancelled) setRecent(rows);
    })().catch(() => {
      if (!cancelled) setRecent([]);
    });
    return () => {
      cancelled = true;
    };
  }, [read, refreshKey]);

  function submit(event) {
    event.preventDefault();
    const text = input.trim().replace(/^#/, "");
    if (!/^\d{1,30}$/.test(text)) {
      setInputError("Enter a listing number, for example 1.");
      return;
    }
    setInputError(null);
    onSelect(String(BigInt(text)));
  }

  return (
    <section aria-labelledby="verify-title">
      <h2 id="verify-title">Verify a listing</h2>
      <p className="lede">
        Enter a listing number from any marketplace. The answer is worked out live from the registry, so it is
        always current. Nothing here needs a wallet.
      </p>

      <form className="verify-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="listing-id">Listing number</label>
          <input
            id="listing-id"
            inputMode="numeric"
            autoComplete="off"
            placeholder="1"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-invalid={Boolean(inputError)}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Verify
        </button>
      </form>
      {inputError && <p className="field-error">{inputError}</p>}

      <div className="recent">
        <h3 className="subhead">Recent listings</h3>
        {recent === null && <Empty>Loading listings…</Empty>}
        {recent && recent.length === 0 && <Empty>No listings yet. A marketplace creates them on the Marketplace tab.</Empty>}
        {recent && recent.length > 0 && (
          <ul className="recent-list">
            {recent.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="recent-item"
                  aria-current={String(row.id) === listingId ? "true" : undefined}
                  onClick={() => onSelect(String(row.id))}
                >
                  <span className="recent-id mono">#{String(row.id)}</span>
                  <span className="recent-main">
                    <strong>{row.productName}</strong>
                    <RecentWho row={row} />
                  </span>
                  <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result.state === "loading" && <Empty>Checking the registry…</Empty>}
      {result.state === "error" && (
        <p className="field-error" role="alert">
          {result.message}
        </p>
      )}
      {result.state === "ready" && <Result data={result.data} />}
    </section>
  );
}

function RecentWho({ row }) {
  const { nameOf } = useChain();
  return (
    <span className="muted">
      {nameOf(row.marketplace)} · sold by {nameOf(row.seller)}
    </span>
  );
}

/** The verdict, the check chain, the product details and the integrity check for one listing. */
function Result({ data }) {
  const { nameOf } = useChain();
  const genuine = data.status === ListingStatus.GENUINE;

  return (
    <div className="result">
      <div
        className={`verdict ${genuine ? "verdict-ok" : "verdict-bad"}`}
        role="status"
        aria-live="polite"
        data-testid="verdict"
        data-status={data.status}
      >
        <Seal ok={genuine} />
        <div className="verdict-text">
          <p className="verdict-title">{genuine ? "Genuine listing" : "Not genuine"}</p>
          <p className="verdict-reason">{VERDICT_REASON[data.status]}</p>
        </div>
        <dl className="verdict-meta">
          <div>
            <dt>Listing</dt>
            <dd className="mono">#{String(data.id)}</dd>
          </div>
          <div>
            <dt>Checked at block</dt>
            <dd className="mono">{data.blockNumber}</dd>
          </div>
        </dl>
      </div>

      {data.found && (
        <>
          <CheckChain data={data} nameOf={nameOf} />

          <div className="panel">
            <h3>
              {data.product.name} <span className="muted">by {data.brand.name || nameOf(data.product.brand)}</span>
            </h3>
            <p className="listing-line">
              Sold by <Address value={data.listing.seller} /> on {nameOf(data.listing.marketplace)} · reference{" "}
              <code className="mono">{data.listing.externalRef}</code> · listed {formatTimestamp(data.listing.createdAt)}
            </p>

            <h4 className="subhead">
              Product details <span className="version-chip">Version {data.latest.number} of {data.versions.length}</span>
            </h4>
            <DetailsView details={data.latest.details} />
            <HashCheck version={data.latest} />
            <VersionHistory versions={data.versions} />
          </div>
        </>
      )}
    </div>
  );
}

/** Listing active → Marketplace active → Brand verified → Product active → Seller authorized. */
function CheckChain({ data, nameOf }) {
  const marketplaceName = nameOf(data.listing.marketplace);
  const brandName = data.brand.name || nameOf(data.product.brand);
  const steps = [
    {
      label: "Listing active",
      pass: data.listing.active,
      detail: data.listing.active ? "The listing has not been removed." : "The listing was removed.",
    },
    {
      label: "Marketplace active",
      pass: data.marketplace.active,
      detail: data.marketplace.active ? `${marketplaceName} is approved.` : `${marketplaceName} is switched off.`,
    },
    {
      label: "Brand verified",
      pass: data.brand.verified,
      detail: data.brand.verified ? `${brandName} is verified by the admin.` : `${brandName} is no longer verified.`,
    },
    {
      label: "Product active",
      pass: data.product.active,
      detail: data.product.active ? "The brand lists this product as active." : "The brand switched this product off.",
    },
    {
      label: "Seller authorized",
      pass: data.sellerAuthorized,
      detail: data.sellerAuthorized
        ? `${brandName} authorizes ${nameOf(data.listing.seller)}.`
        : `${brandName} does not authorize ${nameOf(data.listing.seller)}.`,
    },
  ];

  return (
    <ol className="chain" aria-label="Checks">
      {steps.map((step) => (
        <li key={step.label} className={step.pass ? "chain-pass" : "chain-fail"} data-pass={step.pass}>
          <span className="chain-mark">
            <Icon name={step.pass ? "check" : "cross"} size={15} />
          </span>
          <span className="chain-label">
            <strong>{step.label}</strong>
            <span className="chain-state">{step.pass ? "Pass" : "Fail"}</span>
          </span>
          <span className="chain-detail">{step.detail}</span>
        </li>
      ))}
    </ol>
  );
}

/** Recomputes keccak256 of the details in the browser and compares it with the hash on chain. */
function HashCheck({ version }) {
  const recomputed = hashDetails(version.details);
  const matches = recomputed === version.detailsHash;
  return (
    <div className={`hashcheck ${matches ? "hashcheck-ok" : "hashcheck-bad"}`} data-testid="hash-check">
      <p className="hashcheck-title">
        <Icon name={matches ? "check" : "cross"} size={15} />
        {matches ? "Integrity check passed" : "Integrity check FAILED"}
      </p>
      <p className="muted">
        Your browser recalculated the keccak256 hash of these details and compared it with the hash stored on the
        blockchain.
      </p>
      <dl className="hash-lines">
        <div>
          <dt>Recalculated here</dt>
          <dd>
            <Hash value={recomputed} full />
          </dd>
        </div>
        <div>
          <dt>Stored on chain</dt>
          <dd>
            <Hash value={version.detailsHash} full />
          </dd>
        </div>
      </dl>
    </div>
  );
}
