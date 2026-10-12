// Admin tab: verify or revoke brands, register or switch marketplaces on and off (rule R1).
// The tables are public data and always visible. The forms and buttons need the admin account.
import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import { useChain } from "../context/chainState.js";
import { formatDelay, isSet, loadMultisigInfo } from "../lib/chain.js";
import { formatTimestamp } from "../lib/format.js";
import { useKnownAccounts } from "../lib/useKnownAccounts.js";
import { AddressPicker } from "./AddressPicker.jsx";
import { TxButton } from "./TxButton.jsx";
import { ActiveBadge, Address, Empty, RoleNotice } from "./ui.jsx";

export function AdminView() {
  const { account, roles, catalog, mode, connectWallet } = useChain();
  const isAdmin = roles.isBrandAdmin || roles.isMarketplaceAdmin;
  const adminIsContract = Boolean(catalog?.productsOwnerIsContract || catalog?.listingsOwnerIsContract);

  return (
    <section aria-labelledby="admin-title">
      <h2 id="admin-title">Admin</h2>

      {!account && (
        <RoleNotice title="No wallet connected">
          Connect a wallet to act as the admin.{" "}
          {mode === "metamask" && (
            <button type="button" className="btn btn-secondary" onClick={() => connectWallet().catch(() => {})}>
              Connect wallet
            </button>
          )}
        </RoleNotice>
      )}
      <AdminGovernance />
      {account && !isAdmin && !adminIsContract && (
        <RoleNotice title="This account isn't the platform admin">
          Only the admin can verify brands and register marketplaces. You can read the current state below. To make
          changes, switch to the Admin account.
        </RoleNotice>
      )}

      <BrandsSection canEdit={roles.isBrandAdmin} brands={catalog?.brands} />
      <MarketplacesSection canEdit={roles.isMarketplaceAdmin} marketplaces={catalog?.marketplaces} />
    </section>
  );
}

/**
 * Explains how the admin role is held right now: a shared multisig contract (with its signer count and waiting
 * time), and any handover that has been offered but not accepted yet.
 */
function AdminGovernance() {
  const { catalog, provider } = useChain();
  const [info, setInfo] = useState(null);

  const multisigAddress = catalog?.productsOwnerIsContract
    ? catalog.productsOwner
    : catalog?.listingsOwnerIsContract
      ? catalog.listingsOwner
      : null;

  useEffect(() => {
    if (!multisigAddress || !provider) {
      setInfo(null);
      return undefined;
    }
    let cancelled = false;
    loadMultisigInfo(provider, multisigAddress).then((result) => {
      if (!cancelled) setInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, [multisigAddress, provider]);

  if (!catalog) return null;
  const pending = [...new Set([catalog.productsPendingOwner, catalog.listingsPendingOwner].filter(isSet))];

  return (
    <>
      {multisigAddress && (
        <RoleNotice title="The admin is a shared multisig wallet">
          Brand and marketplace changes are proposed and approved by its signers
          {info ? ` (${info.threshold} of ${info.owners.length} must approve, then ${formatDelay(info.delay)} of waiting)` : ""}
          , so they cannot be made from this page. The multisig is <Address value={multisigAddress} />.
        </RoleNotice>
      )}
      {pending.map((address) => (
        <RoleNotice key={address} title="An admin handover is waiting to be accepted">
          The admin role has been offered to <Address value={address} />. Nothing changes until that address accepts,
          and the current admin keeps full control until then.
        </RoleNotice>
      ))}
    </>
  );
}

function BrandsSection({ canEdit, brands }) {
  const { write, labelFor } = useChain();
  const options = useKnownAccounts({ exclude: ["admin", "marketplace"] });
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="panel">
      <h3>Brands</h3>
      <p className="muted">A brand must be verified here before it can register products.</p>

      {canEdit && (
        <div className="form-row">
          <AddressPicker
            id="brand-address"
            label="Brand wallet"
            value={address}
            onChange={(next) => {
              setAddress(next);
              if (name === "" && labelFor(next)) setName(labelFor(next));
            }}
            options={options}
          />
          <div className="field">
            <label htmlFor="brand-name">Brand name</label>
            <input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fastrack" autoComplete="off" />
          </div>
          <TxButton
            disabled={!isAddress(address) || name.trim() === ""}
            disabledReason="Choose a wallet and enter the brand name."
            action={() => write.products.verifyBrand(address, name.trim())}
            onConfirmed={() => {
              setAddress("");
              setName("");
            }}
          >
            Verify brand
          </TxButton>
        </div>
      )}

      {!brands ? (
        <Empty>Loading…</Empty>
      ) : brands.length === 0 ? (
        <Empty>No brands have been verified yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Brand</th>
              <th scope="col">Wallet</th>
              <th scope="col">Status</th>
              <th scope="col">Last verified</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => (
              <tr key={brand.address}>
                <td data-label="Brand">
                  <strong>{brand.name}</strong>
                </td>
                <td data-label="Wallet">
                  <Address value={brand.address} />
                </td>
                <td data-label="Status">
                  <ActiveBadge active={brand.verified} yes="Verified" no="Revoked" />
                </td>
                <td data-label="Last verified">{formatTimestamp(brand.verifiedAt)}</td>
                <td data-label="Action">
                  {brand.verified ? (
                    <TxButton
                      variant="danger"
                      disabled={!canEdit}
                      disabledReason="Only the admin can do this."
                      action={() => write.products.revokeBrand(brand.address)}
                    >
                      Revoke
                    </TxButton>
                  ) : (
                    <TxButton
                      variant="secondary"
                      disabled={!canEdit}
                      disabledReason="Only the admin can do this."
                      action={() => write.products.verifyBrand(brand.address, brand.name)}
                    >
                      Verify again
                    </TxButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MarketplacesSection({ canEdit, marketplaces }) {
  const { write, labelFor } = useChain();
  const options = useKnownAccounts({ exclude: ["admin", "brand", "seller", "unauthorized seller"] });
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="panel">
      <h3>Marketplaces</h3>
      <p className="muted">Only registered, active marketplaces can create listings.</p>

      {canEdit && (
        <div className="form-row">
          <AddressPicker
            id="market-address"
            label="Marketplace wallet"
            value={address}
            onChange={(next) => {
              setAddress(next);
              if (name === "" && labelFor(next)) setName(labelFor(next));
            }}
            options={options}
          />
          <div className="field">
            <label htmlFor="market-name">Marketplace name</label>
            <input id="market-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Flipkart" autoComplete="off" />
          </div>
          <TxButton
            disabled={!isAddress(address) || name.trim() === ""}
            disabledReason="Choose a wallet and enter the marketplace name."
            action={() => write.listings.registerMarketplace(address, name.trim())}
            onConfirmed={() => {
              setAddress("");
              setName("");
            }}
          >
            Register marketplace
          </TxButton>
        </div>
      )}

      {!marketplaces ? (
        <Empty>Loading…</Empty>
      ) : marketplaces.length === 0 ? (
        <Empty>No marketplaces have been registered yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Marketplace</th>
              <th scope="col">Wallet</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {marketplaces.map((market) => (
              <tr key={market.address}>
                <td data-label="Marketplace">
                  <strong>{market.name}</strong>
                </td>
                <td data-label="Wallet">
                  <Address value={market.address} />
                </td>
                <td data-label="Status">
                  <ActiveBadge active={market.active} />
                </td>
                <td data-label="Action">
                  <TxButton
                    variant={market.active ? "danger" : "secondary"}
                    disabled={!canEdit}
                    disabledReason="Only the admin can do this."
                    action={() => write.listings.setMarketplaceActive(market.address, !market.active)}
                  >
                    {market.active ? "Deactivate" : "Activate"}
                  </TxButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
