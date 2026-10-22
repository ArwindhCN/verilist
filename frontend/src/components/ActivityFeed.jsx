// Live activity feed: every event from both contracts in plain English, newest first.
// One polling loop does both jobs: the first pass reads history from the deployment block, and every
// later pass reads only the new blocks. Each log is keyed by txHash:logIndex, so nothing appears twice.
import { useEffect, useRef, useState } from "react";
import { useChain } from "../context/chainState.js";
import { formatClock } from "../lib/format.js";
import { TxLink } from "./ui.jsx";

const POLL_MS = 1500;
const CHUNK = 2000; // blocks per getLogs call, so public RPC providers do not reject the range
const MAX_ITEMS = 100;

/** Event arguments by name instead of by position. */
function argsByName(parsed) {
  const out = {};
  parsed.fragment.inputs.forEach((input, i) => {
    out[input.name] = parsed.args[i];
  });
  return out;
}

/**
 * One sentence for one event. `item.product` and `item.listing` were looked up when the event arrived;
 * names are looked up here so they stay current as the catalog loads.
 * Returns null for events that would only repeat another line (version 1 is covered by "registered").
 */
function describe(item, nameOf) {
  const a = item.args;
  const productName = item.product?.name ?? "a product";
  const brand = item.product ? nameOf(item.product.brand) : "A brand";

  switch (item.name) {
    case "OwnershipTransferred":
      return a.previousOwner === "0x0000000000000000000000000000000000000000"
        ? `The ${item.source} was deployed. Its admin is ${nameOf(a.newOwner)}.`
        : `The ${item.source}'s admin role moved from ${nameOf(a.previousOwner)} to ${nameOf(a.newOwner)}.`;
    case "OwnershipTransferStarted":
      return `${nameOf(a.previousOwner)} offered the ${item.source}'s admin role to ${nameOf(a.newOwner)}. It takes effect when ${nameOf(a.newOwner)} accepts.`;
    case "BrandVerified":
      return `The admin verified ${a.name} as a brand.`;
    case "BrandRevoked":
      return `The admin revoked ${nameOf(a.brand)}'s brand verification.`;
    case "ProductRegistered":
      return `${nameOf(a.brand)} registered ${a.name}.`;
    case "VersionAdded":
      return Number(a.versionNumber) === 1 ? null : `${brand} updated ${productName} to version ${a.versionNumber}.`;
    case "ProductStatusChanged":
      return `${brand} ${a.active ? "activated" : "deactivated"} ${productName}.`;
    case "SellerAuthorized":
      return `${brand} authorized ${nameOf(a.seller)} to sell ${productName}.`;
    case "SellerRevoked":
      return `${brand} revoked ${nameOf(a.seller)}'s permission to sell ${productName}.`;
    case "MarketplaceRegistered":
      return `The admin registered ${a.name} as a marketplace.`;
    case "MarketplaceStatusChanged":
      return `The admin ${a.active ? "activated" : "deactivated"} ${nameOf(a.marketplace)}.`;
    case "ListingCreated":
      return `${nameOf(a.marketplace)} created listing #${a.listingId} of ${productName} for ${nameOf(a.seller)}.`;
    case "ListingRemoved": {
      const marketplace = item.listing ? nameOf(item.listing.marketplace) : "A marketplace";
      return `${marketplace}'s listing #${a.listingId} was removed by ${nameOf(a.removedBy)}.`;
    }
    default:
      return `${item.name} happened.`;
  }
}

export function ActivityFeed() {
  const { read, provider, deployment, refresh, retry, nameOf } = useChain();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false); // true once the first scan of history has finished
  const scan = useRef({ lastBlock: null, seen: new Set() });

  useEffect(() => {
    if (!read || !provider) return undefined;

    scan.current = { lastBlock: null, seen: new Set() };
    setItems([]);
    setLoaded(false);

    let stopped = false;
    let busy = false;
    let firstPass = true;

    const addresses = [deployment.addresses.ProductRegistry, deployment.addresses.ListingRegistry];
    const interfaceByAddress = {
      [addresses[0].toLowerCase()]: read.products.interface,
      [addresses[1].toLowerCase()]: read.listings.interface,
    };
    const blockTimes = new Map();

    async function timeOf(blockNumber) {
      if (!blockTimes.has(blockNumber)) blockTimes.set(blockNumber, (await provider.getBlock(blockNumber)).timestamp);
      return blockTimes.get(blockNumber);
    }

    async function ingest(log) {
      const parsed = interfaceByAddress[log.address.toLowerCase()]?.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) return null;
      const args = argsByName(parsed);
      const item = {
        key: `${log.transactionHash}:${log.index}`,
        blockNumber: log.blockNumber,
        logIndex: log.index,
        txHash: log.transactionHash,
        name: parsed.name,
        // Which registry emitted it, in plain words (both registries share the ownership events).
        source: log.address.toLowerCase() === addresses[0].toLowerCase() ? "product registry" : "listing registry",
        args,
        product: null,
        listing: null,
        time: await timeOf(log.blockNumber),
      };
      if (args.productId) {
        const product = await read.products.getProduct(args.productId);
        item.product = { name: product.name, brand: product.brand };
      }
      if (parsed.name === "ListingRemoved") {
        const listing = await read.listings.getListing(args.listingId);
        item.listing = { marketplace: listing.marketplace };
      }
      return item;
    }

    async function tick() {
      if (busy || stopped) return;
      busy = true;
      try {
        const head = await provider.getBlockNumber();
        if (scan.current.lastBlock !== null && head < scan.current.lastBlock) {
          retry(); // the chain went backwards: the node was restarted, so reconnect and re-check the deployment
          return;
        }
        const from = scan.current.lastBlock === null ? deployment.deploymentBlock : scan.current.lastBlock + 1;
        const fresh = [];
        for (let start = from; start <= head; start += CHUNK) {
          const end = Math.min(start + CHUNK - 1, head);
          const logs = await provider.getLogs({ address: addresses, fromBlock: start, toBlock: end });
          for (const log of logs) {
            const key = `${log.transactionHash}:${log.index}`;
            if (scan.current.seen.has(key)) continue;
            const item = await ingest(log);
            if (item) {
              scan.current.seen.add(key);
              fresh.push(item);
            }
          }
        }
        if (stopped) return;
        scan.current.lastBlock = head;
        setError(false);
        if (fresh.length > 0) {
          setItems((previous) =>
            [...fresh, ...previous]
              .sort((x, y) => y.blockNumber - x.blockNumber || y.logIndex - x.logIndex)
              .slice(0, MAX_ITEMS)
          );
          if (!firstPass) refresh(); // something changed on chain: let every view reload
        }
        firstPass = false;
        setLoaded(true);
      } catch {
        if (!stopped) setError(true); // node briefly unreachable: keep what we have and try again
      } finally {
        busy = false;
      }
    }

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [read, provider, deployment, refresh, retry]);

  const lines = items.map((item) => ({ item, text: describe(item, nameOf) })).filter((line) => line.text);

  return (
    <aside className="feed" aria-labelledby="feed-title">
      <h2 id="feed-title" className="feed-title">
        Activity <span className={error ? "live live-off" : "live"}>{error ? "Reconnecting…" : "Live"}</span>
      </h2>
      {!loaded ? (
        <p className="empty">Loading activity…</p>
      ) : lines.length === 0 ? (
        <p className="empty">Nothing has happened yet.</p>
      ) : (
        <ol className="feed-list">
          {lines.map(({ item, text }) => (
            <li key={item.key}>
              <p className="feed-text">{text}</p>
              <p className="feed-meta">
                {formatClock(item.time)} · block {item.blockNumber} · <TxLink hash={item.txHash} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
