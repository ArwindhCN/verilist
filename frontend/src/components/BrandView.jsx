// Brand tab: register products, update their details (as new versions), switch them on or off,
// and decide which sellers are authorized. Only a verified brand can do any of this (rules R2, R3).
import { useEffect, useState } from "react";
import { AbiCoder, isAddress, keccak256 } from "ethers";
import { useChain } from "../context/chainState.js";
import { byteLength } from "../lib/format.js";
import { MAX_NAME_BYTES, MAX_SKU_BYTES } from "../lib/details.js";
import { useKnownAccounts } from "../lib/useKnownAccounts.js";
import { useDetailsEditor } from "../lib/useDetailsEditor.js";
import { AddressPicker } from "./AddressPicker.jsx";
import { DetailsEditor } from "./DetailsEditor.jsx";
import { DetailsView, VersionHistory } from "./DetailsView.jsx";
import { TxButton } from "./TxButton.jsx";
import { ActiveBadge, Address, Empty, Hash, RoleNotice } from "./ui.jsx";
import { hashDetails } from "../lib/chain.js";

/** The same formula the contract uses: keccak256(abi.encode(brand, sku)). */
const productIdFor = (brand, sku) => keccak256(AbiCoder.defaultAbiCoder().encode(["address", "string"], [brand, sku]));

export function BrandView() {
  const { account, roles, catalog, mode, connectWallet } = useChain();

  if (!account) {
    return (
      <section aria-labelledby="brand-title">
        <h2 id="brand-title">Brand</h2>
        <RoleNotice title="No wallet connected">
          Connect a wallet to act as a brand.{" "}
          {mode === "metamask" && (
            <button type="button" className="btn btn-secondary" onClick={() => connectWallet().catch(() => {})}>
              Connect wallet
            </button>
          )}
        </RoleNotice>
      </section>
    );
  }

  const brand = roles.brand;
  const verified = Boolean(brand?.verified);
  const mine = (catalog?.products ?? []).filter((p) => p.brand.toLowerCase() === account.toLowerCase());

  return (
    <section aria-labelledby="brand-title">
      <h2 id="brand-title">Brand</h2>

      {!brand && (
        <RoleNotice title="This account isn't a verified brand">
          Only verified brands can register products. Switch to Fastrack or Titan, or ask the admin to verify this
          account on the Admin tab.
        </RoleNotice>
      )}
      {brand && !brand.verified && (
        <RoleNotice title={`${brand.name}'s verification was revoked`}>
          While revoked, this brand cannot register products, update details, switch products on or off, or change
          sellers. Its existing products show as not genuine. Ask the admin to verify it again.
        </RoleNotice>
      )}

      {verified && <RegisterProductForm />}

      <div className="panel">
        <h3>My products</h3>
        {catalog === null && <Empty>Loading…</Empty>}
        {catalog && mine.length === 0 && <Empty>This account has not registered any products yet.</Empty>}
        {mine.map((product) => (
          <ProductCard key={product.id} product={product} verified={verified} />
        ))}
      </div>
    </section>
  );
}

function RegisterProductForm() {
  const { account, write, catalog } = useChain();
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const editor = useDetailsEditor("");

  const skuBytes = byteLength(sku);
  const nameBytes = byteLength(name);
  const skuProblem = skuBytes > MAX_SKU_BYTES ? `SKU is too long (${skuBytes} of ${MAX_SKU_BYTES} bytes).` : null;
  const nameProblem = nameBytes > MAX_NAME_BYTES ? `Name is too long (${nameBytes} of ${MAX_NAME_BYTES} bytes).` : null;
  const productId = sku && !skuProblem ? productIdFor(account, sku) : null;
  const alreadyExists = Boolean(productId && catalog?.products.some((p) => p.id === productId));
  const incomplete = !sku || !name || skuProblem || nameProblem || editor.problems.length > 0 || alreadyExists;

  let disabledReason = "Fill in the SKU, name and at least one detail.";
  if (alreadyExists) disabledReason = "You already registered a product with this SKU.";
  else if (skuProblem || nameProblem) disabledReason = skuProblem ?? nameProblem;
  else if (sku && name && editor.problems.length > 0) disabledReason = editor.problems[0];

  return (
    <div className="panel">
      <h3>Register a product</h3>
      <p className="muted">
        The product's ID is a hash of your wallet address and your SKU, so nobody can register a product under your
        identity, and you cannot register the same SKU twice.
      </p>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="reg-sku">SKU (your product code)</label>
          <input id="reg-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="FT-REFLEX-PRO" autoComplete="off" aria-invalid={Boolean(skuProblem)} />
          {skuProblem && <p className="field-error">{skuProblem}</p>}
        </div>
        <div className="field">
          <label htmlFor="reg-name">Product name</label>
          <input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fastrack Reflex Pro" autoComplete="off" aria-invalid={Boolean(nameProblem)} />
          {nameProblem && <p className="field-error">{nameProblem}</p>}
        </div>
      </div>

      {productId && (
        <p className="field-hint">
          Product ID: <Hash value={productId} />
          {alreadyExists && <span className="field-error"> · already registered</span>}
        </p>
      )}

      <DetailsEditor editor={editor} idPrefix="reg" />

      <div className="actions">
        <TxButton
          disabled={Boolean(incomplete)}
          disabledReason={disabledReason}
          action={() => write.products.registerProduct(sku, name, editor.json)}
          onConfirmed={() => {
            setSku("");
            setName("");
            editor.reset("");
          }}
        >
          Register product
        </TxButton>
      </div>
    </div>
  );
}

/** One product with its controls. Loads its own versions and sellers, and reloads after every change. */
function ProductCard({ product, verified }) {
  const { read, write, refreshKey, labelFor } = useChain();
  const [data, setData] = useState(null);
  const editor = useDetailsEditor("");
  const { reset } = editor;

  useEffect(() => {
    if (!read) return undefined;
    let cancelled = false;
    (async () => {
      const count = Number(await read.products.getVersionCount(product.id));
      const versions = [];
      for (let n = 1; n <= count; n++) {
        const v = await read.products.getVersion(product.id, n);
        versions.push({
          number: n,
          details: v.details,
          detailsHash: v.detailsHash,
          timestamp: v.timestamp,
          hashMatches: hashDetails(v.details) === v.detailsHash,
        });
      }
      const sellers = [...(await read.products.getAuthorizedSellers(product.id))];
      if (!cancelled) setData({ versions, sellers, latest: versions[versions.length - 1] });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [read, product.id, refreshKey]);

  // Prefill the update form with the latest saved version whenever that version changes.
  const latestHash = data?.latest.detailsHash;
  const latestDetails = data?.latest.details;
  useEffect(() => {
    if (latestDetails !== undefined) reset(latestDetails);
  }, [latestHash, latestDetails, reset]);

  const unchanged = data && editor.json === data.latest.details;
  let updateBlock = null;
  if (!verified) updateBlock = "Your brand is not verified.";
  else if (!product.active) updateBlock = "Activate this product before updating its details.";
  else if (unchanged) updateBlock = `No changes yet: this is identical to version ${data.latest.number}.`;
  else if (editor.problems.length > 0) updateBlock = editor.problems[0];

  return (
    <article className="product" aria-label={product.name}>
      <header className="product-head">
        <div>
          <h4>{product.name}</h4>
          <p className="muted">
            SKU <code className="mono">{product.sku}</code>
          </p>
        </div>
        <ActiveBadge active={product.active} />
      </header>
      <p className="field-hint">
        Product ID <Hash value={product.id} />
      </p>

      {data && (
        <p className="muted">
          Latest: <strong>version {data.latest.number}</strong>
        </p>
      )}

      <div className="actions">
        <TxButton
          variant={product.active ? "danger" : "secondary"}
          disabled={!verified}
          disabledReason="Your brand is not verified."
          action={() => write.products.setProductActive(product.id, !product.active)}
        >
          {product.active ? "Deactivate product" : "Activate product"}
        </TxButton>
      </div>

      {data && (
        <>
          <details className="sub">
            <summary>Update details</summary>
            <p className="muted">
              Saving adds a new version. Older versions are never changed, and every marketplace shows the newest one.
            </p>
            <DetailsEditor editor={editor} idPrefix={`upd-${product.id.slice(2, 10)}`} />
            <div className="actions">
              <TxButton
                disabled={Boolean(updateBlock)}
                disabledReason={updateBlock}
                action={() => write.products.updateProductDetails(product.id, editor.json)}
              >
                Publish new version
              </TxButton>
            </div>
          </details>

          <details className="sub" open>
            <summary>Authorized sellers ({data.sellers.length})</summary>
            <SellerList product={product} sellers={data.sellers} verified={verified} labelFor={labelFor} />
          </details>

          <details className="sub">
            <summary>Current details</summary>
            <DetailsView details={data.latest.details} />
          </details>

          <VersionHistory versions={data.versions} />
        </>
      )}
    </article>
  );
}

function SellerList({ product, sellers, verified }) {
  const { write } = useChain();
  const options = useKnownAccounts({ exclude: ["admin", "marketplace"] }).filter((o) => !sellers.includes(o.address));
  const [seller, setSeller] = useState("");

  return (
    <div>
      {sellers.length === 0 ? (
        <Empty>No sellers are authorized yet. Nobody can list this product until you authorize one.</Empty>
      ) : (
        <ul className="seller-list">
          {sellers.map((address) => (
            <li key={address}>
              <Address value={address} />
              <TxButton
                variant="danger"
                disabled={!verified}
                disabledReason="Your brand is not verified."
                action={() => write.products.revokeSeller(product.id, address)}
              >
                Revoke
              </TxButton>
            </li>
          ))}
        </ul>
      )}

      <div className="authorize">
        <AddressPicker
          id={`auth-${product.id.slice(2, 10)}`}
          label="Authorize a seller"
          value={seller}
          onChange={setSeller}
          options={options}
          nameable
        />
        <TxButton
          disabled={!verified || !isAddress(seller)}
          disabledReason={verified ? "Choose or enter a seller address." : "Your brand is not verified."}
          action={() => write.products.authorizeSeller(product.id, seller)}
          onConfirmed={() => setSeller("")}
        >
          Authorize seller
        </TxButton>
      </div>
    </div>
  );
}
