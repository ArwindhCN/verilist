// Friendly sentences for EVERY custom error in the three contracts (Ownable, ProductRegistry,
// ListingRegistry). Kept free of imports on purpose: a Hardhat test (test/ErrorMessages.test.js)
// loads this file and checks that no custom error in the compiled ABIs is missing from the map.
//
// Each message function receives:
//   a  - the error arguments by name, for example { productId, seller }
//   c  - helpers: c.name(address) -> role name or short address, c.product(productId) -> product name

export const ERROR_MESSAGES = {
  // ----- Ownable -----
  NotOwner: (a, c) => `${c.name(a.caller)} is not the platform admin, so it cannot do this. Switch to the Admin account.`,
  NotPendingOwner: (a, c) =>
    `${c.name(a.caller)} has not been offered the admin role, so it cannot accept it. The current admin must offer it first.`,
  ZeroAddress: () => "An empty address (0x000…000) is not allowed here. Enter a real wallet address.",

  // ----- ProductRegistry: input checks -----
  EmptyName: () => "The name cannot be empty.",
  NameTooLong: (a) => `That name is too long (${a.length} bytes). The limit is ${a.max} bytes.`,
  EmptySku: () => "The SKU (your own product code) cannot be empty.",
  SkuTooLong: (a) => `That SKU is too long (${a.length} bytes). The limit is ${a.max} bytes.`,
  EmptyDetails: () => "The product details cannot be empty.",
  DetailsTooLong: (a) => `The product details are too large (${a.length} bytes). The limit is ${a.max} bytes.`,

  // ----- ProductRegistry: brands -----
  BrandAlreadyVerified: (a, c) => `${c.name(a.brand)} is already a verified brand.`,
  BrandNotVerified: (a, c) =>
    `${c.name(a.brand)} is not a verified brand right now. The admin has to verify (or re-verify) it first.`,

  // ----- ProductRegistry: products -----
  ProductAlreadyExists: (a, c) =>
    `This brand already registered a product with that SKU (${c.product(a.productId)}). Use a different SKU.`,
  ProductNotFound: (a, c) => `No product exists with ID ${c.product(a.productId)}.`,
  NotProductBrand: (a, c) =>
    `${c.name(a.caller)} is not the brand that owns ${c.product(a.productId)}. Only the owning brand can change it.`,
  ProductInactive: (a, c) =>
    `${c.product(a.productId)} is switched off by its brand. The brand must activate it first.`,
  DetailsUnchanged: () =>
    "These details are identical to the latest version, so nothing would change. Edit something first.",
  StatusUnchanged: () => "It is already in that state, so there is nothing to change.",
  VersionNotFound: (a, c) => `${c.product(a.productId)} has no version number ${a.versionNumber}. Versions start at 1.`,

  // ----- ProductRegistry: sellers -----
  SellerAlreadyAuthorized: (a, c) =>
    `${c.name(a.seller)} is already authorized to sell ${c.product(a.productId)}.`,
  SellerNotAuthorized: (a, c) =>
    `${c.name(a.seller)} is not authorized by the brand to sell ${c.product(a.productId)}.`,

  // ----- ListingRegistry: marketplaces -----
  MarketplaceNotRegistered: (a, c) =>
    `${c.name(a.marketplace)} is not a registered marketplace. Ask the admin to register it.`,
  MarketplaceNotActive: (a, c) =>
    `${c.name(a.marketplace)} is switched off by the admin, so it cannot create listings right now.`,
  MarketplaceAlreadyRegistered: (a, c) => `${c.name(a.marketplace)} is already registered as a marketplace.`,

  // ----- ListingRegistry: creating listings -----
  DuplicateListing: (a) =>
    `An active listing for this product, seller and marketplace already exists (listing #${a.existingListingId}). Remove it first.`,
  EmptyExternalRef: () => "Enter your marketplace's own listing reference, for example FLIP-883021.",
  ExternalRefTooLong: (a) => `That listing reference is too long (${a.length} bytes). The limit is ${a.max} bytes.`,
  ExternalRefAlreadyUsed: (a) =>
    `This marketplace already used the reference "${a.externalRef}" (even for a removed listing). Use a new one.`,

  // ----- ListingRegistry: removing listings -----
  ListingNotFound: (a) => `There is no listing #${a.listingId}.`,
  NotListingParty: (a, c) =>
    `${c.name(a.caller)} cannot remove listing #${a.listingId}. Only its marketplace or its seller can.`,
  ListingNotActive: (a) => `Listing #${a.listingId} was already removed.`,
};
