// Wording for the ListingStatus values returned by ListingRegistry.
// The numbers match the enum order in ListingRegistry.sol.

export const ListingStatus = {
  GENUINE: 0,
  LISTING_NOT_FOUND: 1,
  LISTING_REMOVED: 2,
  MARKETPLACE_INACTIVE: 3,
  PRODUCT_NOT_FOUND: 4,
  BRAND_NOT_VERIFIED: 5,
  PRODUCT_INACTIVE: 6,
  SELLER_NOT_AUTHORIZED: 7,
  DUPLICATE_LISTING: 8,
};

/** Short label for badges. */
export const STATUS_LABEL = {
  [ListingStatus.GENUINE]: "Genuine",
  [ListingStatus.LISTING_NOT_FOUND]: "Listing not found",
  [ListingStatus.LISTING_REMOVED]: "Listing removed",
  [ListingStatus.MARKETPLACE_INACTIVE]: "Marketplace inactive",
  [ListingStatus.PRODUCT_NOT_FOUND]: "Product not found",
  [ListingStatus.BRAND_NOT_VERIFIED]: "Brand not verified",
  [ListingStatus.PRODUCT_INACTIVE]: "Product inactive",
  [ListingStatus.SELLER_NOT_AUTHORIZED]: "Seller not authorized",
  [ListingStatus.DUPLICATE_LISTING]: "Duplicate listing",
};

/** Plain-words reason shown under the big verdict on the Verify view. */
export const VERDICT_REASON = {
  [ListingStatus.GENUINE]:
    "The brand has registered this product, it is active, and the brand authorizes this seller. The details below come straight from the brand's record.",
  [ListingStatus.LISTING_NOT_FOUND]: "No listing with this number exists in the registry.",
  [ListingStatus.LISTING_REMOVED]: "This listing was removed by its marketplace or its seller.",
  [ListingStatus.MARKETPLACE_INACTIVE]: "The platform admin has switched this marketplace off.",
  [ListingStatus.PRODUCT_NOT_FOUND]: "The product this listing points to does not exist.",
  [ListingStatus.BRAND_NOT_VERIFIED]: "The platform admin has revoked this brand's verification.",
  [ListingStatus.PRODUCT_INACTIVE]: "The brand has switched this product off.",
  [ListingStatus.SELLER_NOT_AUTHORIZED]: "The brand does not authorize this seller to sell this product.",
  [ListingStatus.DUPLICATE_LISTING]: "An active listing for this product, seller and marketplace already exists.",
};

/** Plain-words result of the pre-check on the Marketplace view (before creating a listing). */
export const ELIGIBILITY_REASON = {
  [ListingStatus.GENUINE]: "Can list. The brand, product and seller all check out.",
  [ListingStatus.MARKETPLACE_INACTIVE]: "Cannot list: this marketplace is switched off (or not registered).",
  [ListingStatus.PRODUCT_NOT_FOUND]: "Cannot list: this product does not exist.",
  [ListingStatus.BRAND_NOT_VERIFIED]: "Cannot list: the product's brand is not verified.",
  [ListingStatus.PRODUCT_INACTIVE]: "Cannot list: the brand has switched this product off.",
  [ListingStatus.SELLER_NOT_AUTHORIZED]: "Cannot list: the brand has not authorized this seller for this product.",
  [ListingStatus.DUPLICATE_LISTING]:
    "Cannot list: this seller already has an active listing of this product on your marketplace.",
};

/** Badge tone for a status: "ok" for genuine, "bad" for everything else. */
export const statusTone = (status) => (Number(status) === ListingStatus.GENUINE ? "ok" : "bad");
