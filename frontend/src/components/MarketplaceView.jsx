// Marketplace tab: create listings (with a live pre-check) and manage this marketplace's listings.
// A seller account also gets a table of its own listings here, because a seller may remove them (rule R11).
import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import { useChain } from "../context/chainState.js";
import { fetchAll, loadListingRows } from "../lib/chain.js";
import { byteLength } from "../lib/format.js";
import { ELIGIBILITY_REASON, ListingStatus } from "../lib/status.js";
import { useKnownAccounts } from "../lib/useKnownAccounts.js";
import { AddressPicker } from "./AddressPicker.jsx";
import { TxButton } from "./TxButton.jsx";
import { Address, Empty, Icon, RoleNotice, StatusBadge } from "./ui.jsx";

const MAX_REF_BYTES = 64;

export function MarketplaceView() {
  const { account, roles, mode, connectWallet, deployment, read, refreshKey } = useChain();
  const [sellerRows, setSellerRows] = useState([]);

  // Listings where this account is the SELLER (found through the indexed `seller` field of ListingCreated).
  useEffect(() => {
    if (!read || !account) {
      setSellerRows([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const events = await read.listings.queryFilter(
        read.listings.filters.ListingCreated(null, null, account),
        deployment.deploymentBlock
      );
      const ids = events.map((e) => e.args.listingId).sort((a, b) => (a < b ? 1 : -1));
      const rows = await loadListingRows(ids, read);
      if (!cancelled) setSellerRows(rows);
    })().catch(() => {
      if (!cancelled) setSellerRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [read, account, deployment, refreshKey]);

  if (!account) {
    return (
      <section aria-labelledby="market-title">
        <h2 id="market-title">Marketplace</h2>
        <RoleNotice title="No wallet connected">
          Connect a wallet to act as a marketplace.{" "}
          {mode === "metamask" && (
            <button type="button" className="btn btn-secondary" onClick={() => connectWallet().catch(() => {})}>
              Connect wallet
            </button>
          )}
        </RoleNotice>
      </section>
    );
  }

  const market = roles.marketplace;

  return (
    <section aria-labelledby="market-title">
      <h2 id="market-title">Marketplace</h2>

      {!market && (
        <RoleNotice title="This account isn't a registered marketplace">
          Only registered marketplaces can create listings. Switch to Flipkart or Amazon, or ask the admin to register
          this account on the Admin tab.
        </RoleNotice>
      )}

      {market && !market.active && (
        <RoleNotice title={`${market.name} is switched off`}>
          The admin has deactivated this marketplace, so it cannot create new listings and its existing listings show
          as not genuine. Ask the admin to reactivate it. You can still remove listings below.
        </RoleNotice>
      )}

      {market?.active && <CreateListingForm marketplace={market} />}
      {market && <MarketplaceListings marketplace={market} />}

      {sellerRows.length > 0 && (
        <div className="panel">
          <h3>Listings where you are the seller</h3>
          <p className="muted">As the seller you can remove these listings at any time.</p>
          <ListingTable rows={sellerRows} />
        </div>
      )}
    </section>
  );
}

function CreateListingForm({ marketplace }) {
  const { catalog, read, write, explainError, refreshKey, nameOf } = useChain();
  const sellerOptions = useKnownAccounts({ exclude: ["admin", "marketplace"] });
  const [productId, setProductId] = useState("");
  const [seller, setSeller] = useState("");
  const [ref, setRef] = useState("");
  const [check, setCheck] = useState({ state: "idle" });

  // Live pre-check: asks the contract "could I create this listing right now?" whenever a field changes.
  useEffect(() => {
    if (!read || !productId || !isAddress(seller)) {
      setCheck({ state: "idle" });
      return undefined;
    }
    let cancelled = false;
    setCheck({ state: "loading" });
    const timer = setTimeout(async () => {
      try {
        const status = Number(await read.listings.checkListingEligibility(productId, seller, marketplace.address));
        if (!cancelled) setCheck({ state: "ready", status });
      } catch (error) {
        if (!cancelled) setCheck({ state: "error", message: explainError(error).message });
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // explainError is left out on purpose: it changes whenever names load and must not retrigger the check.
  }, [read, productId, seller, marketplace.address, refreshKey]);

  const products = catalog?.products ?? [];
  const refBytes = byteLength(ref);
  const refProblem = refBytes === 0 ? "Enter your marketplace's own listing reference." : refBytes > MAX_REF_BYTES ? `The reference is too long (${refBytes} of ${MAX_REF_BYTES} bytes).` : null;
  const formIncomplete = !productId || !isAddress(seller) || Boolean(refProblem);
  const willFail = check.state === "ready" && check.status !== ListingStatus.GENUINE;

  return (
    <div className="panel">
      <h3>Create a listing</h3>
      <p className="muted">
        You list as <strong>{marketplace.name}</strong>. The product details always come from the brand, not from the
        seller or from you.
      </p>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="listing-product">Product</label>
          <select id="listing-product" value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="" disabled>
              Choose a product…
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} — {nameOf(product.brand)}
                {product.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>

        <AddressPicker
          id="listing-seller"
          label="Seller"
          value={seller}
          onChange={setSeller}
          options={sellerOptions}
          hint="The wallet of the seller this listing is for."
          nameable
        />

        <div className="field">
          <label htmlFor="listing-ref">Your listing reference</label>
          <input
            id="listing-ref"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            placeholder="FLIP-883021"
            autoComplete="off"
            aria-invalid={ref !== "" && Boolean(refProblem)}
          />
          {ref !== "" && refProblem ? (
            <p className="field-error">{refProblem}</p>
          ) : (
            <p className="field-hint">Your own ID for this listing. It must be new for your marketplace.</p>
          )}
        </div>
      </div>

      <PreCheck check={check} />

      <div className="actions">
        <TxButton
          variant={willFail ? "danger" : "primary"}
          disabled={formIncomplete}
          disabledReason={refProblem && productId && isAddress(seller) ? refProblem : "Choose a product, a seller and enter a reference."}
          action={() => write.listings.createListing(productId, seller, ref)}
          onConfirmed={() => setRef("")}
        >
          {willFail ? "Try anyway (will be rejected)" : "Create listing"}
        </TxButton>
        {willFail && (
          <span className="muted">
            The pre-check says this will fail. You can still send it to see the blockchain reject it.
          </span>
        )}
      </div>
    </div>
  );
}

/** Shows the result of `checkListingEligibility` before anything is sent. */
function PreCheck({ check }) {
  if (check.state === "idle") {
    return (
      <p className="precheck precheck-idle" data-testid="precheck">
        Pick a product and a seller to see whether this listing is allowed.
      </p>
    );
  }
  if (check.state === "loading") {
    return (
      <p className="precheck precheck-idle" data-testid="precheck" role="status">
        Checking with the registry…
      </p>
    );
  }
  if (check.state === "error") {
    return (
      <p className="precheck precheck-bad" data-testid="precheck" role="status">
        <Icon name="cross" /> {check.message}
      </p>
    );
  }
  const ok = check.status === ListingStatus.GENUINE;
  return (
    <p
      className={`precheck ${ok ? "precheck-ok" : "precheck-bad"}`}
      data-testid="precheck"
      data-status={check.status}
      role="status"
    >
      <Icon name={ok ? "check" : "cross"} /> {ELIGIBILITY_REASON[check.status]}
    </p>
  );
}

/** Table of all listings created by this marketplace. */
function MarketplaceListings({ marketplace }) {
  const { read, refreshKey } = useChain();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!read) return undefined;
    let cancelled = false;
    (async () => {
      const ids = await fetchAll((o, l) => read.listings.getMarketplaceListings(marketplace.address, o, l));
      const loaded = await loadListingRows([...ids].reverse(), read);
      if (!cancelled) setRows(loaded);
    })().catch(() => {
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [read, marketplace.address, refreshKey]);

  return (
    <div className="panel">
      <h3>Listings by {marketplace.name}</h3>
      {rows === null ? <Empty>Loading…</Empty> : <ListingTable rows={rows} />}
    </div>
  );
}

/** Listing rows with their live status and a Remove button. */
function ListingTable({ rows }) {
  const { write, nameOf } = useChain();
  if (rows.length === 0) return <Empty>No listings yet.</Empty>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Product</th>
          <th scope="col">Marketplace</th>
          <th scope="col">Seller</th>
          <th scope="col">Reference</th>
          <th scope="col">Version</th>
          <th scope="col">Live status</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row.id)}>
            <td data-label="#" className="mono">
              {String(row.id)}
            </td>
            <td data-label="Product">{row.productName}</td>
            <td data-label="Marketplace">{nameOf(row.marketplace)}</td>
            <td data-label="Seller">
              <Address value={row.seller} />
            </td>
            <td data-label="Reference" className="mono">
              {row.externalRef}
            </td>
            <td data-label="Version">v{row.version}</td>
            <td data-label="Live status">
              <StatusBadge status={row.status} />
            </td>
            <td data-label="Action">
              <TxButton
                variant="danger"
                disabled={!row.active}
                disabledReason="Already removed."
                action={() => write.listings.removeListing(row.id)}
              >
                Remove
              </TxButton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
