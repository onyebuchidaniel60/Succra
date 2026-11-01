// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianRegistry} from './GuardianRegistry.sol';
import {SuccraMission} from './SuccraMission.sol';

/// @title MissionFactory
/// @notice Deploys one SuccraMission per mission and indexes missions by owner.
contract MissionFactory {
    error InvalidGuardianRegistry();

    event MissionFactoryMissionDeployed(address indexed owner, address indexed mission);

    address public immutable guardianRegistry;
    address[] public allMissions;
    mapping(address => address[]) public missionsByOwner;

    constructor(address guardianRegistry_) {
        if (guardianRegistry_ == address(0)) revert InvalidGuardianRegistry();
        guardianRegistry = guardianRegistry_;
    }

    /// @notice Deploys a mission owned by msg.sender. The mission starts ACTIVE.
    function createMission(
        SuccraMission.MissionConfig calldata config
    ) external returns (address missionAddress) {
        address guardian = GuardianRegistry(guardianRegistry).guardian();
        SuccraMission mission = new SuccraMission(msg.sender, config, guardian);
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
