// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SuccraMission} from './SuccraMission.sol';

/// @title MissionFactory
/// @notice Deploys one SuccraMission per mission and indexes missions by owner.
contract MissionFactory {
    error InvalidGuardianRegistry();
    error NotOwner();
    error InvalidToken();

    event MissionFactoryMissionDeployed(address indexed owner, address indexed mission);
    event AllowedTokensUpdated(address[] tokens);

    address public immutable guardianRegistry;
    address public owner;
    bool public tokenAllowlistEnabled;
    mapping(address => bool) public allowedTokens;
    address[] public allMissions;
    mapping(address => address[]) public missionsByOwner;

    constructor(address guardianRegistry_) {
        if (guardianRegistry_ == address(0)) revert InvalidGuardianRegistry();
        guardianRegistry = guardianRegistry_;
        owner = msg.sender;
    }

    /// @notice Restricts new missions to the configured settlement tokens.
    /// @dev Deploy scripts call this with USDG and WIF. Tests may leave it off.
    function setAllowedTokens(address[] calldata tokens) external {
        if (msg.sender != owner) revert NotOwner();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert InvalidToken();
            allowedTokens[tokens[i]] = true;
        }
        tokenAllowlistEnabled = true;
        emit AllowedTokensUpdated(tokens);
    }

    /// @notice Deploys a mission owned by msg.sender. The mission starts ACTIVE.
    function createMission(
        SuccraMission.MissionConfig calldata config
    ) external returns (address missionAddress) {
        if (tokenAllowlistEnabled && !allowedTokens[config.paymentToken]) {
            revert InvalidToken();
        }
        SuccraMission mission = new SuccraMission(msg.sender, config, guardianRegistry);
        missionAddress = address(mission);

        allMissions.push(missionAddress);
        missionsByOwner[msg.sender].push(missionAddress);

        emit MissionFactoryMissionDeployed(msg.sender, missionAddress);
    }

    function getMissionsByOwner(address owner_) external view returns (address[] memory) {
        return missionsByOwner[owner_];
    }

    function totalMissions() external view returns (uint256) {
        return allMissions.length;
    }

    function getMissionAt(uint256 index) external view returns (address) {
        return allMissions[index];
    }
}
