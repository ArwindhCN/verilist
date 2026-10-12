// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Ownable
/// @notice A tiny access-control base contract: one owner (the "admin") who can call restricted functions.
///         Ownership changes in TWO steps: the owner proposes a new owner, and the new owner must accept.
/// @dev Written by hand instead of importing OpenZeppelin so every line can be explained in the viva.
///      The two steps protect against typing a wrong address: nothing changes until the new owner proves
///      it controls its wallet by calling `acceptOwnership`. The owner can be any address, including a
///      multisig contract such as `AdminMultisig`, so the admin does not have to be one person.
abstract contract Ownable {
    /// @notice The address that is allowed to call `onlyOwner` functions.
    address public owner;

    /// @notice The address that has been offered ownership and has not accepted yet (zero if none).
    address public pendingOwner;

    /// @notice Emitted when ownership really changes (also when the contract is deployed).
    /// @param previousOwner The old owner (address(0) at deployment).
    /// @param newOwner The new owner.
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when the owner offers ownership to someone. Nothing has changed yet.
    /// @param previousOwner The current owner who made the offer.
    /// @param newOwner The address that may now accept the offer.
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    /// @notice Thrown when someone who is not the owner calls an owner-only function.
    /// @param caller The address that tried to make the call.
    error NotOwner(address caller);

    /// @notice Thrown when someone who was not offered ownership tries to accept it.
    /// @param caller The address that tried to accept.
    error NotPendingOwner(address caller);

    /// @notice Thrown when the zero address is given where a real address is needed.
    error ZeroAddress();

    /// @notice Makes the deployer the first owner.
    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Restricts a function so only the owner can run it.
    /// @dev Used on every admin function so platform-level rules cannot be changed by outsiders.
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /// @notice Step 1 of 2: offers admin rights to a new address. The owner keeps full control until the offer is accepted.
    /// @dev Zero address is rejected because it could never accept. Calling this again replaces the earlier offer,
    ///      which is also how the owner cancels a wrong offer (offer someone else, or offer it again later).
    /// @param newOwner The address that will be able to accept ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2: the offered address accepts and becomes the owner.
    /// @dev Only `pendingOwner` can call this. It clears the offer so it cannot be used twice.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner(msg.sender);
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }
}
