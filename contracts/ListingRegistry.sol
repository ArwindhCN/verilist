// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "./Ownable.sol";
import {ProductRegistry} from "./ProductRegistry.sol";

/// @title ListingRegistry
/// @notice Lets approved marketplaces create product listings, but only for real, active products
///         and only for sellers the brand has authorized. Anyone can verify a listing at any time.
/// @dev The contract owner is the platform "Admin" who decides which wallets are real marketplaces.
///      A listing stores only a pointer to the product. Its details are always read live from the
///      `ProductRegistry`, so marketplaces can never change product details (rule R9) and a listing's
///      validity is re-checked on every `verifyListing` call (rule R10).
contract ListingRegistry is Ownable {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Maximum length (in bytes) of a marketplace name.
    uint256 public constant MAX_NAME_LENGTH = 100;

    /// @notice Maximum length (in bytes) of a marketplace's own listing reference, for example "FLIP-883021".
    uint256 public constant MAX_EXTERNAL_REF_LENGTH = 64;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice A marketplace wallet known to the platform.
    /// @dev `exists` is true once registered. `active` lets the admin switch a marketplace off.
    struct Marketplace {
        string name;
        bool active;
        bool exists;
    }

    /// @notice One listing of a product by a seller on a marketplace.
    /// @dev `id` is never 0 for a real listing. `externalRef` is the marketplace's own listing ID.
    ///      `active` becomes false when the listing is removed. It is NOT the same as being genuine:
    ///      genuineness is calculated live by `verifyListing`.
    struct Listing {
        uint256 id;
        bytes32 productId;
        address seller;
        address marketplace;
        string externalRef;
        uint64 createdAt;
        bool active;
    }

    /// @notice The result of a listing check, with the specific reason when it is not genuine.
    /// @dev GENUINE: all checks pass. LISTING_NOT_FOUND: no such listing ID. LISTING_REMOVED: it was removed.
    ///      MARKETPLACE_INACTIVE: the marketplace is switched off (or not registered).
    ///      PRODUCT_NOT_FOUND: no such product. BRAND_NOT_VERIFIED: the brand was revoked.
    ///      PRODUCT_INACTIVE: the brand switched the product off. SELLER_NOT_AUTHORIZED: the brand does not
    ///      (or no longer does) authorize this seller. DUPLICATE_LISTING: only returned by
    ///      `checkListingEligibility` when an active listing already exists for the same
    ///      (product, seller, marketplace).
    enum ListingStatus {
        GENUINE,
        LISTING_NOT_FOUND,
        LISTING_REMOVED,
        MARKETPLACE_INACTIVE,
        PRODUCT_NOT_FOUND,
        BRAND_NOT_VERIFIED,
        PRODUCT_INACTIVE,
        SELLER_NOT_AUTHORIZED,
        DUPLICATE_LISTING
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The product registry this contract reads from. Fixed at deployment.
    ProductRegistry public immutable registry;

    /// @notice The ID the next listing will get. Starts at 1, so ID 0 always means "no listing".
    uint256 public nextListingId = 1;

    /// @dev Marketplace records by wallet address.
    mapping(address => Marketplace) private _marketplaces;

    /// @dev Every registered marketplace address (used only by the paginated view).
    address[] private _marketplaceList;

    /// @dev Listing records by ID.
    mapping(uint256 => Listing) private _listings;

    /// @dev The ID of the currently active listing for a listing key, or 0 if there is none.
    ///      This is how duplicates are blocked (rule R8).
    mapping(bytes32 => uint256) private _activeListingByKey;

    /// @dev Marks external references that a marketplace has already used. Never cleared.
    mapping(address => mapping(bytes32 => bool)) private _usedExternalRef;

    /// @dev All listing IDs created by each marketplace (used only by the paginated view).
    mapping(address => uint256[]) private _marketplaceListings;

    /// @dev All listing IDs created for each product (used only by the paginated view).
    mapping(bytes32 => uint256[]) private _productListings;

    // ---------------------------------------------------------------------
    // Events (rule R12: every state change emits an event)
    // ---------------------------------------------------------------------

    /// @notice Emitted when the admin registers a marketplace.
    /// @param marketplace The marketplace wallet.
    /// @param name The marketplace's public name.
    event MarketplaceRegistered(address indexed marketplace, string name);

    /// @notice Emitted when the admin switches a marketplace on or off.
    /// @param marketplace The marketplace wallet.
    /// @param active The new status.
    event MarketplaceStatusChanged(address indexed marketplace, bool active);

    /// @notice Emitted when a marketplace creates a listing.
    /// @param listingId The new listing's ID.
    /// @param productId The product being sold.
    /// @param seller The seller wallet.
    /// @param marketplace The marketplace wallet that created the listing.
    /// @param externalRef The marketplace's own listing reference.
    event ListingCreated(
        uint256 indexed listingId,
        bytes32 indexed productId,
        address indexed seller,
        address marketplace,
        string externalRef
    );

    /// @notice Emitted when a listing is removed.
    /// @param listingId The listing.
    /// @param removedBy The wallet that removed it (the marketplace or the seller).
    event ListingRemoved(uint256 indexed listingId, address indexed removedBy);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice A marketplace name was empty.
    error EmptyName();

    /// @notice A marketplace name was longer than `MAX_NAME_LENGTH`.
    /// @param length The length that was given.
    /// @param max The maximum allowed length.
    error NameTooLong(uint256 length, uint256 max);

    /// @notice The wallet is not a registered marketplace.
    /// @param marketplace The wallet that was checked.
    error MarketplaceNotRegistered(address marketplace);

    /// @notice The marketplace is registered but currently switched off.
    /// @param marketplace The marketplace wallet.
    error MarketplaceNotActive(address marketplace);

    /// @notice The admin tried to register a marketplace twice.
    /// @param marketplace The marketplace wallet.
    error MarketplaceAlreadyRegistered(address marketplace);

    /// @notice The requested active/inactive status is already the current status.
    error StatusUnchanged();

    /// @notice No product exists with this ID.
    /// @param productId The ID that was looked up.
    error ProductNotFound(bytes32 productId);

    /// @notice The product's brand is not currently verified.
    /// @param brand The brand wallet.
    error BrandNotVerified(address brand);

    /// @notice The product is switched off.
    /// @param productId The product.
    error ProductInactive(bytes32 productId);

    /// @notice The brand has not authorized this seller for this product.
    /// @param productId The product.
    /// @param seller The seller wallet.
    error SellerNotAuthorized(bytes32 productId, address seller);

    /// @notice An active listing already exists for the same product, seller and marketplace.
    /// @param existingListingId The ID of that existing listing.
    error DuplicateListing(uint256 existingListingId);

    /// @notice The external reference was empty.
    error EmptyExternalRef();

    /// @notice The external reference was longer than `MAX_EXTERNAL_REF_LENGTH`.
    /// @param length The length that was given.
    /// @param max The maximum allowed length.
    error ExternalRefTooLong(uint256 length, uint256 max);

    /// @notice This marketplace has already used this external reference.
    /// @param externalRef The reference that was reused.
    error ExternalRefAlreadyUsed(string externalRef);

    /// @notice No listing exists with this ID.
    /// @param listingId The ID that was looked up.
    error ListingNotFound(uint256 listingId);

    /// @notice The caller is neither the listing's marketplace nor its seller.
    /// @param listingId The listing.
    /// @param caller The wallet that tried to remove it.
    error NotListingParty(uint256 listingId, address caller);

    /// @notice The listing was already removed.
    /// @param listingId The listing.
    error ListingNotActive(uint256 listingId);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    /// @notice Lets only a registered, active marketplace run the function (rule R6).
    /// @dev Gives two different errors so the caller learns whether it was never registered or just switched off.
    modifier onlyActiveMarketplace() {
        Marketplace storage marketplace = _marketplaces[msg.sender];
        if (!marketplace.exists) revert MarketplaceNotRegistered(msg.sender);
        if (!marketplace.active) revert MarketplaceNotActive(msg.sender);
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @notice Connects this contract to the product registry it will read from.
    /// @dev The address is stored as `immutable`, so it can never be changed after deployment.
    /// @param productRegistry The deployed `ProductRegistry` address. The zero address is rejected.
    constructor(address productRegistry) {
        if (productRegistry == address(0)) revert ZeroAddress();
        registry = ProductRegistry(productRegistry);
    }

    // ---------------------------------------------------------------------
    // Admin functions (rule R1)
    // ---------------------------------------------------------------------

    /// @notice Admin registers a wallet as a real marketplace. It starts active.
    /// @param marketplace The marketplace wallet.
    /// @param name The marketplace's public name, for example "Flipkart".
    function registerMarketplace(address marketplace, string calldata name) external onlyOwner {
        if (marketplace == address(0)) revert ZeroAddress();
        uint256 length = bytes(name).length;
        if (length == 0) revert EmptyName();
        if (length > MAX_NAME_LENGTH) revert NameTooLong(length, MAX_NAME_LENGTH);
        if (_marketplaces[marketplace].exists) revert MarketplaceAlreadyRegistered(marketplace);

        _marketplaces[marketplace] = Marketplace({name: name, active: true, exists: true});
        _marketplaceList.push(marketplace);

        emit MarketplaceRegistered(marketplace, name);
    }

    /// @notice Admin switches a marketplace on or off.
    /// @dev Switching off makes every listing of that marketplace show "not genuine" and blocks new
    ///      listings. Switching on again restores them (rule R10).
    /// @param marketplace The marketplace wallet.
    /// @param active True to switch on, false to switch off.
    function setMarketplaceActive(address marketplace, bool active) external onlyOwner {
        Marketplace storage m = _marketplaces[marketplace];
        if (!m.exists) revert MarketplaceNotRegistered(marketplace);
        if (m.active == active) revert StatusUnchanged();

        m.active = active;

        emit MarketplaceStatusChanged(marketplace, active);
    }

    // ---------------------------------------------------------------------
    // Marketplace functions (rules R6, R7, R8, R11)
    // ---------------------------------------------------------------------

    /// @notice An active marketplace creates a listing of a product for a seller.
    /// @dev The blockchain checks everything, in this order, with a specific error each time:
    ///      product exists, brand verified, product active, seller authorized, no duplicate active
    ///      listing, external reference valid and unused (rules R6, R7, R8).
    ///      Seller `address(0)` can never be authorized, so it is rejected as `SellerNotAuthorized`.
    /// @param productId The product being listed.
    /// @param seller The seller wallet.
    /// @param externalRef The marketplace's own listing ID, for example "FLIP-883021".
    /// @return listingId The new listing's ID.
    function createListing(bytes32 productId, address seller, string calldata externalRef)
        external
        onlyActiveMarketplace
        returns (uint256 listingId)
    {
        ListingStatus status = _eligibility(productId, seller, msg.sender);
        if (status != ListingStatus.GENUINE) _revertForStatus(status, productId, seller, msg.sender);

        uint256 refLength = bytes(externalRef).length;
        if (refLength == 0) revert EmptyExternalRef();
        if (refLength > MAX_EXTERNAL_REF_LENGTH) revert ExternalRefTooLong(refLength, MAX_EXTERNAL_REF_LENGTH);
        bytes32 refHash = keccak256(bytes(externalRef));
        if (_usedExternalRef[msg.sender][refHash]) revert ExternalRefAlreadyUsed(externalRef);

        listingId = nextListingId;
        nextListingId = listingId + 1;

        _listings[listingId] = Listing({
            id: listingId,
            productId: productId,
            seller: seller,
            marketplace: msg.sender,
            externalRef: externalRef,
            createdAt: uint64(block.timestamp),
            active: true
        });
        _activeListingByKey[_listingKey(productId, seller, msg.sender)] = listingId;
        _usedExternalRef[msg.sender][refHash] = true;
        _marketplaceListings[msg.sender].push(listingId);
        _productListings[productId].push(listingId);

        emit ListingCreated(listingId, productId, seller, msg.sender, externalRef);
    }

    /// @notice Removes a listing. Only the listing's marketplace or its seller may do this (rule R11).
    /// @dev Frees the (product, seller, marketplace) key so the same listing can be created again later.
    ///      The external reference stays used, so a re-listing needs a new reference.
    /// @param listingId The listing to remove.
    function removeListing(uint256 listingId) external {
        Listing storage listing = _listings[listingId];
        if (listing.id == 0) revert ListingNotFound(listingId);
        if (msg.sender != listing.marketplace && msg.sender != listing.seller) {
            revert NotListingParty(listingId, msg.sender);
        }
        if (!listing.active) revert ListingNotActive(listingId);

        listing.active = false;
        delete _activeListingByKey[_listingKey(listing.productId, listing.seller, listing.marketplace)];

        emit ListingRemoved(listingId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Pre-check: tells whether a marketplace could create this listing right now, and if not, why.
    /// @dev Uses the same order of checks as `createListing`. It cannot check the external reference
    ///      because it is not an input here. A marketplace that is not registered is reported as
    ///      MARKETPLACE_INACTIVE.
    /// @param productId The product.
    /// @param seller The seller wallet.
    /// @param marketplace The marketplace wallet that would create the listing.
    /// @return GENUINE if the listing could be created, otherwise the reason it could not.
    function checkListingEligibility(bytes32 productId, address seller, address marketplace)
        external
        view
        returns (ListingStatus)
    {
        return _eligibility(productId, seller, marketplace);
    }

    /// @notice Live check: is this listing genuine right now? If not, why not?
    /// @dev Nothing is cached. The answer is recalculated from the current state of both registries, so it
    ///      changes the moment the brand or admin changes something, and changes back when it is fixed (R10).
    ///      Checks in this order: found, not removed, marketplace active, product exists, brand verified,
    ///      product active, seller authorized.
    /// @param listingId The listing to verify.
    /// @return The listing's current status.
    function verifyListing(uint256 listingId) external view returns (ListingStatus) {
        return _verify(_listings[listingId]);
    }

    /// @notice Returns a listing's record.
    /// @param listingId The listing. Reverts with `ListingNotFound` if it does not exist.
    /// @return The listing record.
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _getListing(listingId);
    }

    /// @notice Returns a listing, the product's latest details version and the live status, in one call.
    /// @dev The details always come from the brand's latest version, not from anything the marketplace
    ///      stored (rule R9). This is what a marketplace page or a buyer's app would call.
    /// @param listingId The listing. Reverts with `ListingNotFound` if it does not exist.
    /// @return listing The listing record.
    /// @return latest The product's latest details version.
    /// @return status The listing's current status.
    function getListingWithDetails(uint256 listingId)
        external
        view
        returns (Listing memory listing, ProductRegistry.Version memory latest, ListingStatus status)
    {
        listing = _getListing(listingId);
        latest = registry.getLatestVersion(listing.productId);
        status = _verify(listing);
    }

    /// @notice Returns a marketplace's record. For an unknown wallet, every field is empty/false.
    /// @param marketplace The marketplace wallet.
    /// @return The marketplace record.
    function getMarketplace(address marketplace) external view returns (Marketplace memory) {
        return _marketplaces[marketplace];
    }

    /// @notice Returns how many marketplaces have been registered.
    /// @return The number of marketplaces.
    function getMarketplaceCount() external view returns (uint256) {
        return _marketplaceList.length;
    }

    /// @notice Returns a page of marketplace wallet addresses.
    /// @dev If `offset` is at or beyond the list length, an empty array is returned (never reverts).
    /// @param offset Index of the first item to return.
    /// @param limit Maximum number of items to return.
    /// @return A page of marketplace addresses.
    function getMarketplaces(uint256 offset, uint256 limit) external view returns (address[] memory) {
        (uint256 start, uint256 count) = _pageBounds(_marketplaceList.length, offset, limit);
        address[] memory page = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _marketplaceList[start + i];
        }
        return page;
    }

    /// @notice Returns a page of the listing IDs created by a marketplace (including removed ones).
    /// @dev If `offset` is at or beyond the list length, an empty array is returned (never reverts).
    /// @param marketplace The marketplace wallet.
    /// @param offset Index of the first item to return.
    /// @param limit Maximum number of items to return.
    /// @return A page of listing IDs.
    function getMarketplaceListings(address marketplace, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory)
    {
        return _slice(_marketplaceListings[marketplace], offset, limit);
    }

    /// @notice Returns a page of the listing IDs created for a product (including removed ones).
    /// @dev If `offset` is at or beyond the list length, an empty array is returned (never reverts).
    /// @param productId The product.
    /// @param offset Index of the first item to return.
    /// @param limit Maximum number of items to return.
    /// @return A page of listing IDs.
    function getProductListings(bytes32 productId, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory)
    {
        return _slice(_productListings[productId], offset, limit);
    }

    /// @notice Returns how many listings have ever been created (removed ones included).
    /// @return The total listing count. Listing IDs run from 1 to this number.
    function getListingCount() external view returns (uint256) {
        return nextListingId - 1;
    }

    /// @notice Calculates the key used to block duplicate active listings, without touching storage.
    /// @dev Same formula used inside `createListing`: keccak256(abi.encode(productId, seller, marketplace)).
    /// @param productId The product.
    /// @param seller The seller wallet.
    /// @param marketplace The marketplace wallet.
    /// @return The listing key.
    function computeListingKey(bytes32 productId, address seller, address marketplace)
        external
        pure
        returns (bytes32)
    {
        return _listingKey(productId, seller, marketplace);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /// @dev Key formula shared by `createListing`, `removeListing`, the pre-check and `computeListingKey`.
    function _listingKey(bytes32 productId, address seller, address marketplace) internal pure returns (bytes32) {
        return keccak256(abi.encode(productId, seller, marketplace));
    }

    /// @dev Reads a listing or reverts with `ListingNotFound`.
    function _getListing(uint256 listingId) internal view returns (Listing memory listing) {
        listing = _listings[listingId];
        if (listing.id == 0) revert ListingNotFound(listingId);
    }

    /// @dev Checks the product and seller in the registry. Shared by the pre-check and the live check
    ///      so both always agree on the order and meaning of each reason.
    function _productAndSellerStatus(bytes32 productId, address seller) internal view returns (ListingStatus) {
        ProductRegistry.ProductStatus productStatus = registry.productStatus(productId);
        if (productStatus == ProductRegistry.ProductStatus.NOT_FOUND) return ListingStatus.PRODUCT_NOT_FOUND;
        if (productStatus == ProductRegistry.ProductStatus.BRAND_NOT_VERIFIED) {
            return ListingStatus.BRAND_NOT_VERIFIED;
        }
        if (productStatus == ProductRegistry.ProductStatus.INACTIVE) return ListingStatus.PRODUCT_INACTIVE;
        if (!registry.isAuthorizedSeller(productId, seller)) return ListingStatus.SELLER_NOT_AUTHORIZED;
        return ListingStatus.GENUINE;
    }

    /// @dev The "could this listing be created?" check used by both `createListing` and the pre-check view.
    function _eligibility(bytes32 productId, address seller, address marketplace)
        internal
        view
        returns (ListingStatus)
    {
        if (!_marketplaces[marketplace].active) return ListingStatus.MARKETPLACE_INACTIVE;

        ListingStatus status = _productAndSellerStatus(productId, seller);
        if (status != ListingStatus.GENUINE) return status;

        if (_activeListingByKey[_listingKey(productId, seller, marketplace)] != 0) {
            return ListingStatus.DUPLICATE_LISTING;
        }
        return ListingStatus.GENUINE;
    }

    /// @dev The live check used by `verifyListing` and `getListingWithDetails`.
    function _verify(Listing memory listing) internal view returns (ListingStatus) {
        if (listing.id == 0) return ListingStatus.LISTING_NOT_FOUND;
        if (!listing.active) return ListingStatus.LISTING_REMOVED;
        if (!_marketplaces[listing.marketplace].active) return ListingStatus.MARKETPLACE_INACTIVE;
        return _productAndSellerStatus(listing.productId, listing.seller);
    }

    /// @dev Turns a failed eligibility status into the matching custom error, so `createListing` reports
    ///      exactly why it was rejected. MARKETPLACE_INACTIVE cannot reach here because
    ///      `onlyActiveMarketplace` already rejected it, which leaves DUPLICATE_LISTING as the last case.
    function _revertForStatus(ListingStatus status, bytes32 productId, address seller, address marketplace)
        internal
        view
    {
        if (status == ListingStatus.PRODUCT_NOT_FOUND) revert ProductNotFound(productId);
        if (status == ListingStatus.BRAND_NOT_VERIFIED) revert BrandNotVerified(registry.getProduct(productId).brand);
        if (status == ListingStatus.PRODUCT_INACTIVE) revert ProductInactive(productId);
        if (status == ListingStatus.SELLER_NOT_AUTHORIZED) revert SellerNotAuthorized(productId, seller);
        revert DuplicateListing(_activeListingByKey[_listingKey(productId, seller, marketplace)]);
    }

    /// @dev Copies a page out of a stored list of listing IDs.
    function _slice(uint256[] storage ids, uint256 offset, uint256 limit) internal view returns (uint256[] memory) {
        (uint256 start, uint256 count) = _pageBounds(ids.length, offset, limit);
        uint256[] memory page = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = ids[start + i];
        }
        return page;
    }

    /// @dev Turns (offset, limit) into a safe slice of a list. If `offset` is at or past the end the
    ///      slice is empty; otherwise the slice is cut so it never runs past the end of the list.
    function _pageBounds(uint256 length, uint256 offset, uint256 limit)
        internal
        pure
        returns (uint256 start, uint256 count)
    {
        if (offset >= length) return (0, 0);
        uint256 remaining = length - offset;
        return (offset, limit < remaining ? limit : remaining);
    }
}
