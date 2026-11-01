// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GuardianRegistry
/// @notice Stores the single global Succra guardian address and allows the owner to rotate it.
contract GuardianRegistry {
    error NotOwner();
    error ZeroAddress();

    address public owner;
    address public guardian;

    event GuardianRotated(address indexed previous, address indexed next);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialGuardian) {
        if (initialGuardian == address(0)) revert ZeroAddress();
        owner = msg.sender;
        guardian = initialGuardian;
    }

    /// @notice Rotates the global guardian. Only the registry owner may call this.
    function rotateGuardian(address nextGuardian) external onlyOwner {
        if (nextGuardian == address(0)) revert ZeroAddress();
        address previous = guardian;
        guardian = nextGuardian;
        emit GuardianRotated(previous, nextGuardian);
    }
}
