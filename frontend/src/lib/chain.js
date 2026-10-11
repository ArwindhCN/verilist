// Read-only data loaders. Every function takes the contracts it needs, so the React code stays small.
import { keccak256, toUtf8Bytes } from "ethers";
import { ListingStatus } from "./status.js";

const PAGE_SIZE = 50;

/** Calls a paginated view (offset, limit) until the whole list has been read. */
export async function fetchAll(pageFn, pageSize = PAGE_SIZE) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await pageFn(offset, pageSize);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

/** Everything the dropdowns and tables need: owners, brands, marketplaces and all products. */
export async function fetchCatalog({ products, listings }) {
  const [productsOwner, listingsOwner, brandAddresses, marketplaceAddresses] = await Promise.all([
    products.owner(),
    listings.owner(),
    fetchAll((o, l) => products.getBrands(o, l)),
    fetchAll((o, l) => listings.getMarketplaces(o, l)),
  ]);

  const brands = await Promise.all(
    brandAddresses.map(async (address) => {
      const brand = await products.getBrand(address);
      return { address, name: brand.name, verified: brand.verified, verifiedAt: brand.verifiedAt };
    })
  );

  const marketplaces = await Promise.all(
    marketplaceAddresses.map(async (address) => {
      const marketplace = await listings.getMarketplace(address);
      return { address, name: marketplace.name, active: marketplace.active };
    })
  );

  const perBrand = await Promise.all(
    brands.map(async (brand) => {
      const ids = await fetchAll((o, l) => products.getBrandProducts(brand.address, o, l));
      return Promise.all(
        ids.map(async (id) => {
          const product = await products.getProduct(id);
          return {
            id,
            brand: product.brand,
            sku: product.sku,
            name: product.name,
            active: product.active,
            createdAt: product.createdAt,
          };
        })
      );
    })
  );

  return { productsOwner, listingsOwner, brands, marketplaces, products: perBrand.flat() };
}

/**
 * The newest block number, straight from the node.
 * `provider.getBlockNumber()` is avoided on purpose: ethers caches it for 250 ms, so right after a
 * transaction it can return the previous block, and a verdict pinned to that block would be out of date.
 */
export async function latestBlock(provider) {
  return Number(BigInt(await provider.send("eth_blockNumber", [])));
}

/** keccak256 of the details text, computed in the browser (used for the integrity check). */
export const hashDetails = (details) => keccak256(toUtf8Bytes(details));

/**
 * Loads everything the Verify view shows for one listing, all from the same block so the verdict and
 * the check chain cannot disagree with each other.
 * Returns { found: false } when the listing does not exist.
 */
export async function loadVerification(id, { provider, products, listings }) {
  const blockTag = await latestBlock(provider);
  const at = { blockTag };

  const status = Number(await listings.verifyListing(id, at));
  if (status === ListingStatus.LISTING_NOT_FOUND) return { found: false, id, status, blockNumber: blockTag };

  const listing = await listings.getListing(id, at);
  const [product, marketplace, sellerAuthorized, versionCount] = await Promise.all([
    products.getProduct(listing.productId, at),
    listings.getMarketplace(listing.marketplace, at),
    products.isAuthorizedSeller(listing.productId, listing.seller, at),
    products.getVersionCount(listing.productId, at),
  ]);
  const brand = await products.getBrand(product.brand, at);

  const versions = [];
  for (let n = 1; n <= Number(versionCount); n++) {
    const version = await products.getVersion(listing.productId, n, at);
    versions.push({
      number: n,
      details: version.details,
      detailsHash: version.detailsHash,
      timestamp: version.timestamp,
      // Recomputed here in the browser: proves the stored text really hashes to the stored hash.
      hashMatches: hashDetails(version.details) === version.detailsHash,
    });
  }

  return {
    found: true,
    id,
    status,
    blockNumber: blockTag,
    listing: {
      id: listing.id,
      productId: listing.productId,
      seller: listing.seller,
      marketplace: listing.marketplace,
      externalRef: listing.externalRef,
      createdAt: listing.createdAt,
      active: listing.active,
    },
    product: { brand: product.brand, sku: product.sku, name: product.name, active: product.active },
    brand: { name: brand.name, verified: brand.verified },
    marketplace: { name: marketplace.name, active: marketplace.active },
    sellerAuthorized,
    versions,
    latest: versions[versions.length - 1],
  };
}

/** Small summary rows for a list of listing ids: used by the recent-listings list and tables. */
export async function loadListingRows(ids, { listings, products }) {
  return Promise.all(
    ids.map(async (id) => {
      const [listing, status] = await Promise.all([listings.getListing(id), listings.verifyListing(id)]);
      const [product, versionCount] = await Promise.all([
        products.getProduct(listing.productId),
        products.getVersionCount(listing.productId),
      ]);
      return {
        id: listing.id,
        productId: listing.productId,
        productName: product.name,
        seller: listing.seller,
        marketplace: listing.marketplace,
        externalRef: listing.externalRef,
        active: listing.active,
        version: Number(versionCount),
        status: Number(status),
      };
    })
  );
}
