// Holds everything the views share: the connection (local node or MetaMask), the current account and
// signer, the contracts, a catalog of brands/marketplaces/products, and helpers for names and errors.
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, JsonRpcSigner, Network, getAddress } from "ethers";
import { addressNames, deployment, demoAccounts, LOCAL_CHAIN_ID, LOCAL_RPC_URL } from "../lib/config.js";
import { mergeAddressNames, normalizeAddressNames, parseSavedNames, serializeSavedNames, withSavedName } from "../lib/addressNames.js";
import { fetchCatalog } from "../lib/chain.js";
import { decodeError } from "../lib/errors.js";
import { ChainContext } from "./chainState.js";
import { readStored, shortAddress, shortHash, writeStored } from "../lib/format.js";

const MODE_KEY = "verilist-mode";
const ACCOUNT_KEY = "verilist-demo-account";
const NAMES_KEY = "verilist-address-names"; // names typed into the website, kept in this browser only

/** Local demo mode for a Hardhat deployment, MetaMask mode for everything else (for example Sepolia). */
function initialMode() {
  if (!deployment || deployment.chainId !== LOCAL_CHAIN_ID) return "metamask";
  return readStored(MODE_KEY) === "metamask" ? "metamask" : "demo";
}

/** Asks the local node for its chain id without creating an ethers provider (which would retry noisily). */
async function rpcChainId(url) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const json = await response.json();
  return Number(BigInt(json.result));
}

/** Connects to the local Hardhat node. Returns either { setup } (something to fix) or a ready connection. */
async function bootDemo() {
  let chainId;
  try {
    chainId = await rpcChainId(LOCAL_RPC_URL);
  } catch {
    return { setup: { kind: "node-down" } };
  }
  if (chainId !== deployment.chainId) return { setup: { kind: "wrong-chain", actual: chainId } };

  const network = Network.from(chainId);
  const provider = new JsonRpcProvider(LOCAL_RPC_URL, network, { staticNetwork: network });
  provider.pollingInterval = 1000;

  if ((await provider.getCode(deployment.addresses.ProductRegistry)) === "0x") {
    provider.destroy();
    return { setup: { kind: "not-deployed" } };
  }

  let accounts;
  if (demoAccounts) {
    accounts = Object.entries(demoAccounts).map(([name, info]) => ({
      name,
      role: info.role,
      address: info.address,
      index: info.index,
    }));
  } else {
    // Seed has not run yet: fall back to the node's own accounts, without role names.
    const signers = await provider.listAccounts();
    accounts = signers.map((signer, index) => ({ name: `Account #${index}`, role: "", address: signer.address, index }));
  }
  return { provider, chainId, accounts, walletAccount: null };
}

/** Connects through MetaMask (or another injected wallet). */
async function bootWallet() {
  const ethereum = window.ethereum;
  if (!ethereum) return { setup: { kind: "no-wallet" } };

  const provider = new BrowserProvider(ethereum);
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== deployment.chainId) {
    provider.destroy();
    return { setup: { kind: "wrong-network", actual: chainId } };
  }
  if ((await provider.getCode(deployment.addresses.ProductRegistry)) === "0x") {
    provider.destroy();
    return { setup: { kind: "not-deployed" } };
  }
  // `eth_accounts` never opens a popup: it only returns accounts the user already shared with this site.
  const shared = await ethereum.request({ method: "eth_accounts" });
  return { provider, chainId, accounts: [], walletAccount: shared[0] ?? null };
}

export function ChainProvider({ children }) {
  const [mode, setMode] = useState(initialMode);
  const [bootKey, setBootKey] = useState(0); // bump to run the boot again (retry, chain changed, ...)
  const [conn, setConn] = useState({ phase: "loading" });
  const [demoAddress, setDemoAddress] = useState(() => readStored(ACCOUNT_KEY));
  const [walletAccount, setWalletAccount] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastTx, setLastTx] = useState(null); // result of a transaction whose button has since disappeared
  const [savedNames, setSavedNames] = useState(() => parseSavedNames(readStored(NAMES_KEY))); // [{ name, address }]

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const retry = useCallback(() => setBootKey((k) => k + 1), []);

  // ----- boot: connect to the chain and check that the contracts are really there -----
  useEffect(() => {
    let cancelled = false;
    let provider = null;
    setConn({ phase: "loading" });

    (async () => {
      if (!deployment) {
        setConn({ phase: "setup", setup: { kind: "no-deployment" } });
        return;
      }
      try {
        const result = mode === "demo" ? await bootDemo() : await bootWallet();
        if (cancelled) {
          result.provider?.destroy();
          return;
        }
        if (result.setup) {
          setConn({ phase: "setup", setup: result.setup });
          return;
        }
        provider = result.provider;
        setWalletAccount(result.walletAccount);
        setConn({ phase: "ready", provider, chainId: result.chainId, accounts: result.accounts });
      } catch (error) {
        if (!cancelled) setConn({ phase: "setup", setup: { kind: "error", message: String(error?.message ?? error) } });
      }
    })();

    return () => {
      cancelled = true;
      provider?.destroy();
    };
  }, [mode, bootKey]);

  // ----- wallet events (MetaMask mode only) -----
  useEffect(() => {
    if (mode !== "metamask" || !window.ethereum) return undefined;
    const ethereum = window.ethereum;
    const onAccountsChanged = (accounts) => setWalletAccount(accounts[0] ?? null);
    const onChainChanged = () => setBootKey((k) => k + 1); // simplest safe reaction: connect again
    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [mode]);

  // ----- which account is acting -----
  const accounts = conn.accounts ?? [];
  const account =
    mode === "demo"
      ? (accounts.find((a) => a.address === demoAddress) ?? accounts[0])?.address ?? null
      : walletAccount;

  const selectAccount = useCallback((address) => {
    setDemoAddress(address);
    writeStored(ACCOUNT_KEY, address);
  }, []);

  // The signer is built straight from the account address. `provider.getSigner(address)` is avoided on
  // purpose: for a wallet it checks the account list and, if the account is no longer in it (the user just
  // switched accounts), it silently asks the wallet for permission again. Building the signer directly makes
  // no wallet calls, so it can never pop up an unrequested prompt, and it is ready immediately.
  const signer = useMemo(
    () => (conn.phase === "ready" && account ? new JsonRpcSigner(conn.provider, getAddress(account)) : null),
    [conn.phase, conn.provider, account]
  );

  // ----- contracts: `read` talks to the node, `write` signs as the current account -----
  const read = useMemo(() => {
    if (conn.phase !== "ready") return null;
    const { ProductRegistry, ListingRegistry } = deployment.addresses;
    return {
      products: new Contract(ProductRegistry, deployment.abis.ProductRegistry, conn.provider),
      listings: new Contract(ListingRegistry, deployment.abis.ListingRegistry, conn.provider),
    };
  }, [conn.phase, conn.provider]);

  const write = useMemo(
    () => (read && signer ? { products: read.products.connect(signer), listings: read.listings.connect(signer) } : null),
    [read, signer]
  );

  // ----- catalog of brands, marketplaces and products (reloaded after every change) -----
  useEffect(() => {
    if (!read) {
      setCatalog(null);
      return undefined;
    }
    let cancelled = false;
    fetchCatalog(read)
      .then((data) => {
        if (cancelled) return;
        setCatalog(data);
        setCatalogError(null);
      })
      .catch((error) => {
        if (!cancelled) setCatalogError(String(error?.shortMessage ?? error?.message ?? error));
      });
    return () => {
      cancelled = true;
    };
  }, [read, refreshKey]);

  // ----- nicknames: the optional file plus names typed into the website (the typed ones win) -----
  const nicknames = useMemo(() => mergeAddressNames(normalizeAddressNames(addressNames), savedNames), [savedNames]);
  /** Saves (or, with an empty name, forgets) a name for an address. It only changes this browser. */
  const saveName = useCallback(
    (address, name) => {
      const next = withSavedName(savedNames, address, name);
      writeStored(NAMES_KEY, serializeSavedNames(next));
      setSavedNames(next);
    },
    [savedNames]
  );

  // ----- names: demo role names first, then your own nicknames, then the names registered on chain -----
  const nameMap = useMemo(() => {
    const map = new Map();
    if (deployment?.chainId === LOCAL_CHAIN_ID && demoAccounts) {
      for (const [name, info] of Object.entries(demoAccounts)) map.set(info.address.toLowerCase(), name);
    }
    // Your own nicknames (address-names.json, then names typed into the website) name addresses the blockchain
    // does not, such as sellers.
    for (const { name, address } of nicknames) map.set(address.toLowerCase(), name);
    if (catalog) {
      const ownerName = (isContract) => (isContract ? "Admin multisig" : "Admin");
      for (const [owner, isContract] of [
        [catalog.productsOwner, catalog.productsOwnerIsContract],
        [catalog.listingsOwner, catalog.listingsOwnerIsContract],
      ]) {
        if (!map.has(owner.toLowerCase()) || isContract) map.set(owner.toLowerCase(), ownerName(isContract));
      }
      for (const brand of catalog.brands) if (brand.name) map.set(brand.address.toLowerCase(), brand.name);
      for (const market of catalog.marketplaces) if (market.name) map.set(market.address.toLowerCase(), market.name);
    }
    return map;
  }, [catalog, nicknames]);

  const labelFor = useCallback((address) => (address ? (nameMap.get(address.toLowerCase()) ?? null) : null), [nameMap]);
  const nameOf = useCallback((address) => labelFor(address) ?? shortAddress(address), [labelFor]);
  const productName = useCallback(
    (id) => catalog?.products.find((p) => p.id === id)?.name ?? `product ${shortHash(id)}`,
    [catalog]
  );

  /** Turns any thrown error into a friendly sentence. */
  const explainError = useCallback(
    (error) =>
      decodeError(error, read ? [read.products.interface, read.listings.interface] : [], {
        name: nameOf,
        product: productName,
      }),
    [read, nameOf, productName]
  );

  // ----- what the current account is allowed to do -----
  const roles = useMemo(() => {
    const lower = account?.toLowerCase();
    const brand = catalog?.brands.find((b) => b.address.toLowerCase() === lower) ?? null;
    const marketplace = catalog?.marketplaces.find((m) => m.address.toLowerCase() === lower) ?? null;
    return {
      isBrandAdmin: Boolean(lower && catalog && catalog.productsOwner.toLowerCase() === lower),
      isMarketplaceAdmin: Boolean(lower && catalog && catalog.listingsOwner.toLowerCase() === lower),
      brand, // record if this account was ever verified (check .verified for current status)
      marketplace, // record if this account is a registered marketplace
    };
  }, [account, catalog]);

  // ----- wallet actions -----
  const connectWallet = useCallback(async () => {
    const accountsShared = await window.ethereum.request({ method: "eth_requestAccounts" });
    setWalletAccount(accountsShared[0] ?? null);
  }, []);

  const switchNetwork = useCallback(async () => {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${deployment.chainId.toString(16)}` }],
    });
  }, []);

  const canUseWallet = typeof window !== "undefined" && Boolean(window.ethereum);
  const switchMode = useCallback((next) => {
    writeStored(MODE_KEY, next);
    setMode(next);
  }, []);

  const value = {
    deployment,
    phase: conn.phase,
    setup: conn.setup,
    mode,
    canSwitchMode: deployment?.chainId === LOCAL_CHAIN_ID && canUseWallet,
    switchMode,
    retry,
    provider: conn.provider ?? null,
    chainId: conn.chainId ?? null,
    accounts,
    account,
    selectAccount,
    connectWallet,
    switchNetwork,
    read,
    write,
    catalog,
    catalogError,
    labelFor,
    nicknames,
    savedNames,
    saveName,
    nameOf,
    productName,
    explainError,
    roles,
    refreshKey,
    refresh,
    lastTx,
    reportTx: setLastTx,
  };

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}
