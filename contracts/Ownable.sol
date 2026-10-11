// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Ownable
/// @notice A tiny access-control base contract: one owner (the "admin") who can call restricted functions.
/// @dev Written by hand instead of importing OpenZeppelin so every line can be explained in the viva.
abstract contract Ownable {
    /// @notice The address that is allowed to call `onlyOwner` functions.
    address public owner;

    /// @notice Emitted when ownership changes (also when the contract is deployed).
    /// @param previousOwner The old owner (address(0) at deployment).
    /// @param newOwner The new owner.
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Thrown when someone who is not the owner calls an owner-only function.
    /// @param caller The address that tried to make the call.
    error NotOwner(address caller);

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

    /// @notice Hands admin rights to a new address.
    /// @dev Zero address is rejected because it would lock the admin functions forever.
    /// @param newOwner The address that becomes the new owner.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }
}
