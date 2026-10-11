// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "./Ownable.sol";

/// @title ProductRegistry
/// @notice The single source of truth for brands, their products, product details and authorized sellers.
/// @dev The contract owner is the platform "Admin". Admin decides which wallets are real brands.
///      Verified brands then register products and manage everything about them. Product details are
///      never overwritten: every change is appended as a new numbered version (rule R4).
contract ProductRegistry is Ownable {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Maximum length (in bytes) of a brand name or a product name.
    uint256 public constant MAX_NAME_LENGTH = 100;

    /// @notice Maximum length (in bytes) of a product SKU (the brand's own product code).
    uint256 public constant MAX_SKU_LENGTH = 64;

    /// @notice Maximum length (in bytes) of the product details JSON string.
    uint256 public constant MAX_DETAILS_LENGTH = 4096;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Information about a brand wallet.
    /// @dev `exists` is true once the admin has verified the wallet at least once. `verified` can later
    ///      become false if the admin revokes the brand. `verifiedAt` is when it was last verified.
    struct Brand {
        string name;
        bool verified;
        uint64 verifiedAt;
        bool exists;
    }

    /// @notice A product registered by a brand.
    /// @dev `brand` and `sku` together make the product ID. `active` lets the brand switch the product
    ///      off (for example when it is discontinued) without deleting history.
    struct Product {
        address brand;
        string sku;
        string name;
        bool active;
        uint64 createdAt;
        bool exists;
    }

    /// @notice One saved version of a product's details.
    /// @dev `details` is a JSON string, `detailsHash` is its keccak256 hash, `timestamp` is when it was saved.
    struct Version {
        string details;
        bytes32 detailsHash;
        uint64 timestamp;
    }

    /// @notice A short summary of whether a product can currently be sold.
    /// @dev NOT_FOUND: no such product. BRAND_NOT_VERIFIED: the brand was revoked by the admin.
    ///      INACTIVE: the brand switched the product off. VALID: everything is fine.
    enum ProductStatus {
        NOT_FOUND,
        BRAND_NOT_VERIFIED,
        INACTIVE,
        VALID
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @dev Brand details by wallet address.
    mapping(address => Brand) private _brands;

    /// @dev Every address that was ever verified as a brand (used only by the paginated view).
    address[] private _brandList;

    /// @dev Product details by product ID.
    mapping(bytes32 => Product) private _products;

    /// @dev Append-only list of versions for each product. Version number N is stored at index N - 1.
    mapping(bytes32 => Version[]) private _versions;

    /// @dev All product IDs registered by each brand (used only by the paginated view).
    mapping(address => bytes32[]) private _brandProducts;

    /// @dev True if `seller` is currently allowed to sell the product. This is what listings check.
    mapping(bytes32 => mapping(address => bool)) private _authorizedSeller;

    /// @dev Every seller that was ever authorized for a product (used only by `getAuthorizedSellers`).
    mapping(bytes32 => address[]) private _sellerHistory;

    /// @dev Remembers which sellers are already in `_sellerHistory` so re-authorizing never adds a duplicate.
    mapping(bytes32 => mapping(address => bool)) private _inSellerHistory;

    // ---------------------------------------------------------------------
    // Events (rule R12: every state change emits an event)
    // ---------------------------------------------------------------------

    /// @notice Emitted when the admin verifies a brand wallet.
    /// @param brand The brand wallet.
    /// @param name The brand's public name.
    event BrandVerified(address indexed brand, string name);

    /// @notice Emitted when the admin revokes a brand's verified status.
    /// @param brand The brand wallet.
    event BrandRevoked(address indexed brand);

    /// @notice Emitted when a brand registers a new product.
    /// @param productId The brand-scoped product ID.
    /// @param brand The brand that owns the product.
    /// @param sku The brand's own product code.
    /// @param name The product name.
    event ProductRegistered(bytes32 indexed productId, address indexed brand, string sku, string name);

    /// @notice Emitted whenever a new details version is stored (including version 1 at registration).
    /// @param productId The product.
    /// @param versionNumber The new version number (starts at 1).
    /// @param detailsHash keccak256 hash of the details JSON string.
    event VersionAdded(bytes32 indexed productId, uint256 versionNumber, bytes32 detailsHash);

    /// @notice Emitted when a brand switches a product on or off.
    /// @param productId The product.
    /// @param active The new status.
    event ProductStatusChanged(bytes32 indexed productId, bool active);

    /// @notice Emitted when a brand authorizes a seller for a product.
    /// @param productId The product.
    /// @param seller The seller wallet.
    event SellerAuthorized(bytes32 indexed productId, address indexed seller);

    /// @notice Emitted when a brand revokes a seller's authorization for a product.
    /// @param productId The product.
    /// @param seller The seller wallet.
    event SellerRevoked(bytes32 indexed productId, address indexed seller);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice A name (brand or product) was empty.
    error EmptyName();

    /// @notice A name (brand or product) was longer than `MAX_NAME_LENGTH`.
    /// @param length The length that was given.
    /// @param max The maximum allowed length.
    error NameTooLong(uint256 length, uint256 max);

    /// @notice A SKU was empty.
    error EmptySku();

    /// @notice A SKU was longer than `MAX_SKU_LENGTH`.
    /// @param length The length that was given.
    /// @param max The maximum allowed length.
    error SkuTooLong(uint256 length, uint256 max);

    /// @notice A details string was empty.
    error EmptyDetails();

    /// @notice A details string was longer than `MAX_DETAILS_LENGTH`.
    /// @param length The length that was given.
    /// @param max The maximum allowed length.
    error DetailsTooLong(uint256 length, uint256 max);

    /// @notice The admin tried to verify a brand that is already verified.
    /// @param brand The brand wallet.
    error BrandAlreadyVerified(address brand);

    /// @notice The wallet is not a currently verified brand.
    /// @param brand The wallet that was checked.
    error BrandNotVerified(address brand);

    /// @notice The brand already registered a product with this SKU.
    /// @param productId The ID that already exists.
    error ProductAlreadyExists(bytes32 productId);

    /// @notice No product exists with this ID.
    /// @param productId The ID that was looked up.
    error ProductNotFound(bytes32 productId);

    /// @notice The caller is not the brand that owns the product.
    /// @param productId The product.
    /// @param caller The wallet that tried to change it.
    error NotProductBrand(bytes32 productId, address caller);

    /// @notice The product is switched off, so the action is not allowed.
    /// @param productId The product.
    error ProductInactive(bytes32 productId);

    /// @notice The new details are identical to the latest version, so nothing would change.
    /// @param productId The product.
    error DetailsUnchanged(bytes32 productId);

    /// @notice The requested active/inactive status is already the current status.
    error StatusUnchanged();

    /// @notice The seller is already authorized for this product.
    /// @param productId The product.
    /// @param seller The seller wallet.
    error SellerAlreadyAuthorized(bytes32 productId, address seller);

    /// @notice The seller is not currently authorized for this product.
    /// @param productId The product.
    /// @param seller The seller wallet.
    error SellerNotAuthorized(bytes32 productId, address seller);

    /// @notice The requested version number does not exist (versions start at 1).
    /// @param productId The product.
    /// @param versionNumber The version number that was requested.
    error VersionNotFound(bytes32 productId, uint256 versionNumber);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    /// @notice Lets only a currently verified brand run the function.
    /// @dev Used by `registerProduct`, where no product exists yet to check against.
    modifier onlyVerifiedBrand() {
        if (!_brands[msg.sender].verified) revert BrandNotVerified(msg.sender);
        _;
    }

    /// @notice Lets only the owning, still-verified brand of an existing product run the function.
    /// @dev Enforces rule R3: the product must exist, the caller must be its brand, and that brand
    ///      must still be verified (a revoked brand loses control until the admin verifies it again).
    /// @param productId The product being changed.
    modifier onlyProductBrand(bytes32 productId) {
        Product storage product = _products[productId];
        if (!product.exists) revert ProductNotFound(productId);
        if (product.brand != msg.sender) revert NotProductBrand(productId, msg.sender);
        if (!_brands[msg.sender].verified) revert BrandNotVerified(msg.sender);
        _;
    }

    // ---------------------------------------------------------------------
    // Admin functions (rule R1)
    // ---------------------------------------------------------------------

    /// @notice Admin confirms that a wallet really belongs to a brand.
    /// @dev Re-verifying a previously revoked brand is allowed and updates its name. Verifying a brand
    ///      that is currently verified reverts so the admin notices mistakes.
    /// @param brand The brand wallet.
    /// @param name The brand's public name, for example "Fastrack".
    function verifyBrand(address brand, string calldata name) external onlyOwner {
        if (brand == address(0)) revert ZeroAddress();
        _validateName(name);

        Brand storage b = _brands[brand];
        if (b.verified) revert BrandAlreadyVerified(brand);

        if (!b.exists) {
            b.exists = true;
            _brandList.push(brand);
        }
        b.name = name;
        b.verified = true;
        b.verifiedAt = uint64(block.timestamp);

        emit BrandVerified(brand, name);
    }

    /// @notice Admin removes a brand's verified status (for example if the wallet was compromised).
    /// @dev The brand's products stay on chain but become invalid for new and existing listings (rule R10).
    /// @param brand The brand wallet.
    function revokeBrand(address brand) external onlyOwner {
        Brand storage b = _brands[brand];
        if (!b.verified) revert BrandNotVerified(brand);

        b.verified = false;

        emit BrandRevoked(brand);
    }

    // ---------------------------------------------------------------------
    // Brand functions (rules R2, R3, R4, R5)
    // ---------------------------------------------------------------------

    /// @notice A verified brand registers a new product and its first details version.
    /// @dev The product ID is hash(brand address, sku), so a brand can never claim another brand's
    ///      product identity (rule R2). The product starts active with version 1.
    /// @param sku The brand's own product code, for example "FT-REFLEX-PRO".
    /// @param name The product name shown to buyers.
    /// @param details The product details as a JSON string.
    /// @return productId The new product's ID.
    function registerProduct(string calldata sku, string calldata name, string calldata details)
        external
        onlyVerifiedBrand
        returns (bytes32 productId)
    {
        _validateSku(sku);
        _validateName(name);
        _validateDetails(details);

        productId = _productIdOf(msg.sender, sku);
        if (_products[productId].exists) revert ProductAlreadyExists(productId);

        _products[productId] = Product({
            brand: msg.sender,
            sku: sku,
            name: name,
            active: true,
            createdAt: uint64(block.timestamp),
            exists: true
        });
        _brandProducts[msg.sender].push(productId);

        emit ProductRegistered(productId, msg.sender, sku, name);
        _appendVersion(productId, details, keccak256(bytes(details)));
    }

    /// @notice The brand saves new details for its product as a new version.
    /// @dev Old versions are never changed or deleted (rule R4). If the new details hash equals the
    ///      latest version's hash the call reverts (rule R5), so version numbers always mean a real change.
    /// @param productId The product to update.
    /// @param newDetails The complete new details JSON string.
    function updateProductDetails(bytes32 productId, string calldata newDetails)
        external
        onlyProductBrand(productId)
    {
        if (!_products[productId].active) revert ProductInactive(productId);
        _validateDetails(newDetails);

        bytes32 newHash = keccak256(bytes(newDetails));
        Version[] storage versions = _versions[productId];
        if (versions[versions.length - 1].detailsHash == newHash) revert DetailsUnchanged(productId);

        _appendVersion(productId, newDetails, newHash);
    }

    /// @notice The brand switches its product on or off.
    /// @dev An inactive product cannot get new listings and existing listings show "not genuine" until
    ///      it is switched on again.
    /// @param productId The product.
    /// @param active True to switch on, false to switch off.
    function setProductActive(bytes32 productId, bool active) external onlyProductBrand(productId) {
        Product storage product = _products[productId];
        if (product.active == active) revert StatusUnchanged();

        product.active = active;

        emit ProductStatusChanged(productId, active);
    }

    /// @notice The brand allows a seller to sell this product.
    /// @dev A brand may authorize its own wallet (an "official store"). The zero address is rejected.
    /// @param productId The product.
    /// @param seller The seller wallet to allow.
    function authorizeSeller(bytes32 productId, address seller) external onlyProductBrand(productId) {
        if (seller == address(0)) revert ZeroAddress();
        if (_authorizedSeller[productId][seller]) revert SellerAlreadyAuthorized(productId, seller);

        _authorizedSeller[productId][seller] = true;
        if (!_inSellerHistory[productId][seller]) {
            _inSellerHistory[productId][seller] = true;
            _sellerHistory[productId].push(seller);
        }

        emit SellerAuthorized(productId, seller);
    }

    /// @notice The brand stops allowing a seller to sell this product.
    /// @dev Takes effect immediately for every listing of this seller for this product (rule R10).
    /// @param productId The product.
    /// @param seller The seller wallet to remove.
    function revokeSeller(bytes32 productId, address seller) external onlyProductBrand(productId) {
        if (!_authorizedSeller[productId][seller]) revert SellerNotAuthorized(productId, seller);

        _authorizedSeller[productId][seller] = false;

        emit SellerRevoked(productId, seller);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Calculates the product ID for a brand and SKU without touching storage.
    /// @dev Same formula as `registerProduct`: keccak256(abi.encode(brand, sku)).
    /// @param brand The brand wallet.
    /// @param sku The brand's own product code.
    /// @return The product ID.
    function computeProductId(address brand, string calldata sku) external pure returns (bytes32) {
        return _productIdOf(brand, sku);
    }

    /// @notice Returns a brand's record. For an unknown wallet, every field is empty/false.
    /// @param brand The brand wallet.
    /// @return The brand record.
    function getBrand(address brand) external view returns (Brand memory) {
        return _brands[brand];
    }

    /// @notice Returns how many wallets have ever been verified as brands.
    /// @return The number of brands in the list.
    function getBrandCount() external view returns (uint256) {
        return _brandList.length;
    }

    /// @notice Returns a page of brand wallet addresses (including revoked ones).
    /// @dev If `offset` is at or beyond the list length, an empty array is returned (never reverts).
    /// @param offset Index of the first item to return.
    /// @param limit Maximum number of items to return.
    /// @return A page of brand addresses.
    function getBrands(uint256 offset, uint256 limit) external view returns (address[] memory) {
        (uint256 start, uint256 count) = _pageBounds(_brandList.length, offset, limit);
        address[] memory page = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _brandList[start + i];
        }
        return page;
    }

    /// @notice Returns a product's record.
    /// @param productId The product.
    /// @return The product record. Reverts with `ProductNotFound` if it does not exist.
    function getProduct(bytes32 productId) external view returns (Product memory) {
        Product memory product = _products[productId];
        if (!product.exists) revert ProductNotFound(productId);
        return product;
    }

    /// @notice Returns a page of the product IDs registered by a brand.
    /// @dev If `offset` is at or beyond the list length, an empty array is returned (never reverts).
    /// @param brand The brand wallet.
    /// @param offset Index of the first item to return.
    /// @param limit Maximum number of items to return.
    /// @return A page of product IDs.
    function getBrandProducts(address brand, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        bytes32[] storage ids = _brandProducts[brand];
        (uint256 start, uint256 count) = _pageBounds(ids.length, offset, limit);
        bytes32[] memory page = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = ids[start + i];
        }
        return page;
    }

    /// @notice Returns how many versions a product has (0 if the product does not exist).
    /// @param productId The product.
    /// @return The number of versions.
    function getVersionCount(bytes32 productId) external view returns (uint256) {
        return _versions[productId].length;
    }

    /// @notice Returns one saved version of a product's details.
    /// @dev Versions are numbered from 1. Version 0 or a number past the latest reverts.
    /// @param productId The product.
    /// @param versionNumber The 1-based version number.
    /// @return The version record.
    function getVersion(bytes32 productId, uint256 versionNumber) external view returns (Version memory) {
        Version[] storage versions = _versions[productId];
        if (versionNumber == 0 || versionNumber > versions.length) {
            revert VersionNotFound(productId, versionNumber);
        }
        return versions[versionNumber - 1];
    }

    /// @notice Returns the newest version of a product's details. This is what every marketplace shows.
    /// @param productId The product. Reverts with `ProductNotFound` if it does not exist.
    /// @return The latest version record.
    function getLatestVersion(bytes32 productId) external view returns (Version memory) {
        Version[] storage versions = _versions[productId];
        if (versions.length == 0) revert ProductNotFound(productId);
        return versions[versions.length - 1];
    }

    /// @notice Tells whether a seller is currently authorized to sell a product.
    /// @param productId The product.
    /// @param seller The seller wallet.
    /// @return True if authorized right now.
    function isAuthorizedSeller(bytes32 productId, address seller) external view returns (bool) {
        return _authorizedSeller[productId][seller];
    }

    /// @notice Returns only the sellers that are authorized right now (revoked sellers are left out).
    /// @dev Loops over the product's seller history. Only the owning brand can grow that history, so the
    ///      list is as long as the brand itself made it. This is a view, so it costs no gas to a caller.
    /// @param productId The product.
    /// @return The currently authorized sellers.
    function getAuthorizedSellers(bytes32 productId) external view returns (address[] memory) {
        address[] storage history = _sellerHistory[productId];
        uint256 total = history.length;

        // First pass: count how many are still authorized, so the result array has the right size.
        uint256 count = 0;
        for (uint256 i = 0; i < total; i++) {
            if (_authorizedSeller[productId][history[i]]) count++;
        }

        // Second pass: copy them.
        address[] memory sellers = new address[](count);
        uint256 next = 0;
        for (uint256 i = 0; i < total; i++) {
            address seller = history[i];
            if (_authorizedSeller[productId][seller]) {
                sellers[next] = seller;
                next++;
            }
        }
        return sellers;
    }

    /// @notice Summarizes whether a product can currently be sold.
    /// @dev Checks in this order: exists, brand verified, product active.
    /// @param productId The product.
    /// @return The product's current status.
    function productStatus(bytes32 productId) external view returns (ProductStatus) {
        Product storage product = _products[productId];
        if (!product.exists) return ProductStatus.NOT_FOUND;
        if (!_brands[product.brand].verified) return ProductStatus.BRAND_NOT_VERIFIED;
        if (!product.active) return ProductStatus.INACTIVE;
        return ProductStatus.VALID;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /// @dev Product ID formula shared by `registerProduct` and `computeProductId`.
    function _productIdOf(address brand, string calldata sku) internal pure returns (bytes32) {
        return keccak256(abi.encode(brand, sku));
    }

    /// @dev Saves a new version at the end of the list and emits `VersionAdded`.
    function _appendVersion(bytes32 productId, string calldata details, bytes32 detailsHash) internal {
        _versions[productId].push(
            Version({details: details, detailsHash: detailsHash, timestamp: uint64(block.timestamp)})
        );
        emit VersionAdded(productId, _versions[productId].length, detailsHash);
    }

    /// @dev Rejects empty names and names longer than `MAX_NAME_LENGTH`.
    function _validateName(string calldata name) internal pure {
        uint256 length = bytes(name).length;
        if (length == 0) revert EmptyName();
        if (length > MAX_NAME_LENGTH) revert NameTooLong(length, MAX_NAME_LENGTH);
    }

    /// @dev Rejects empty SKUs and SKUs longer than `MAX_SKU_LENGTH`.
    function _validateSku(string calldata sku) internal pure {
        uint256 length = bytes(sku).length;
        if (length == 0) revert EmptySku();
        if (length > MAX_SKU_LENGTH) revert SkuTooLong(length, MAX_SKU_LENGTH);
    }

    /// @dev Rejects empty details and details longer than `MAX_DETAILS_LENGTH`.
    function _validateDetails(string calldata details) internal pure {
        uint256 length = bytes(details).length;
        if (length == 0) revert EmptyDetails();
        if (length > MAX_DETAILS_LENGTH) revert DetailsTooLong(length, MAX_DETAILS_LENGTH);
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
