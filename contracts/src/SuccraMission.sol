// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {GuardianRegistry} from './GuardianRegistry.sol';

/// @title SuccraMission
/// @notice Authoritative mission authority and policy for one Succra mission.
/// @dev Funds never enter this contract. HSP executes settlement; this contract
///      enforces mission authority, policy, and payment authorization.
contract SuccraMission {
    struct Successor {
        address agent;
        uint16 priority; // lower wins
        bool active;
    }

    struct MissionConfig {
        address paymentToken;
        uint256 budgetAtomic;
        uint256 maxPaymentAtomic;
        uint256 recoveryMaxPaymentAtomic;
        address[] merchantAllowlist;
        uint64 expiresAt;
        bytes32 policyHash;
        address primaryAgent;
        Successor[] successors;
        uint16 violationThreshold;
        uint64 violationWindowSeconds;
        bytes32 cartMandateHash;
    }

    enum MissionStatus {
        DRAFT, // reserved; not entered on-chain in MVP
        ACTIVE,
        DEGRADED, // reserved; not entered in MVP
        QUARANTINED, // reserved for Phase 5
        RECOVERING, // reserved for Phase 6
        ACTIVE_RECOVERY, // reserved for Phase 6
        COMPLETED,
        CANCELLED,
        EXPIRED,
        HALTED // reserved; DB mirror only
    }

    struct AuthorityState {
        address currentAgent;
        MissionStatus status;
        uint64 agentNonce;
        uint64 stateVersion;
        uint16 violationCount;
        uint64 lastViolationAt;
        uint256 confirmedSpentAtomic;
        bytes32 lastCheckpointHash;
        uint64 lastCheckpointSequence;
    }

    struct Checkpoint {
        uint64 sequence;
        bytes32 checkpointHash;
        uint64 committedAt;
    }

    struct PaymentAuthorization {
        bytes32 requestId;
        address agent;
        address merchant;
        address token;
        uint256 amountAtomic;
        uint64 paymentNonce;
        uint64 expiresAt;
        bytes32 mandateHash;
        bytes agentSignature;
    }

    error NotOwner();
    error NotGuardian();
    error NotCurrentAgent();
    error InvalidStatus();
    error InvalidVersion();
    error InvalidAmount();
    error InvalidMerchant();
    error InvalidToken();
    error InvalidExpiry();
    error InvalidNonce();
    error RequestAlreadyUsed();
    error InvalidSignature();
    error InvalidSuccessor();
    error SuccessorAlreadyExists();
    error SuccessorLimitExceeded();
    error PrimaryAgentInSuccessors();
    error InvalidViolationThreshold();
    error InvalidViolationWindow();
    error NotAuthorized();
    error AmountMismatch();
    error AlreadyRecorded();
    error ZeroAddress();

    event MissionCreated(address indexed owner, address indexed mission, bytes32 policyHash);
    event PolicyUpdated(bytes32 indexed policyHash, uint64 stateVersion);
    event AgentAuthorized(address indexed agent, uint8 role, uint64 stateVersion);
    event AgentRevoked(address indexed agent, uint64 stateVersion);
    event PaymentAuthorized(
        bytes32 indexed requestId,
        address indexed merchant,
        uint256 amountAtomic,
        bytes32 mandateHash
    );
    event PaymentSettlementRecorded(
        bytes32 indexed paymentId,
        uint256 amountAtomic,
        bytes32 transactionHash
    );
    event ViolationRecorded(bytes32 indexed requestId, uint16 violationCount, uint64 stateVersion);
    event MissionQuarantined(address indexed guardian, uint64 stateVersion);
    event MissionStatusChanged(
        MissionStatus previous,
        MissionStatus next,
        uint64 stateVersion
    );
    event SuccessorActivated(
        address indexed successor,
        bytes32 checkpointHash,
        uint64 stateVersion
    );
    event RecoveryAcknowledged(address indexed successor, uint64 stateVersion);
    event CheckpointCommitted(uint64 sequence, bytes32 checkpointHash);
    event MissionCancelled(address indexed owner, uint64 stateVersion);
    event MissionExpired(address indexed owner, uint64 stateVersion);

    MissionConfig public config;
    AuthorityState public authority;
    address public owner;
    GuardianRegistry public immutable guardianRegistry;

    mapping(bytes32 => bool) public usedRequestIds;
    mapping(bytes32 => bool) public authorizedRequests;
    mapping(bytes32 => uint256) public authorizedAmount;
    mapping(bytes32 => bool) public recordedSettlements;
    mapping(address => bool) public allowedMerchants;
    mapping(address => uint16) public successorPriority;
    mapping(address => bool) public successorActive;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Reads the live global guardian from GuardianRegistry so registry
    ///      rotation applies to existing missions. Runtime settlement reporting
    ///      is guardian-authorized.
    modifier onlyGuardian() {
        if (msg.sender != guardianRegistry.guardian()) revert NotGuardian();
        _;
    }

    /// @notice Deployed by MissionFactory. The mission starts ACTIVE; DRAFT is
    ///         reserved for the off-chain mirror state only.
    /// @dev Policies are immutable after creation. The Cart Mandate hash is
    ///      committed here; HSP remains authoritative for settlement.
    constructor(address owner_, MissionConfig memory config_, address guardianRegistry_) {
        if (owner_ == address(0) || guardianRegistry_ == address(0)) revert ZeroAddress();
        _validateConfig(config_);

        owner = owner_;
        guardianRegistry = GuardianRegistry(guardianRegistry_);

        config.paymentToken = config_.paymentToken;
        config.budgetAtomic = config_.budgetAtomic;
        config.maxPaymentAtomic = config_.maxPaymentAtomic;
        config.recoveryMaxPaymentAtomic = config_.recoveryMaxPaymentAtomic;
        config.expiresAt = config_.expiresAt;
        config.policyHash = config_.policyHash;
        config.primaryAgent = config_.primaryAgent;
        config.violationThreshold = config_.violationThreshold;
        config.violationWindowSeconds = config_.violationWindowSeconds;
        config.cartMandateHash = config_.cartMandateHash;

        for (uint256 i = 0; i < config_.merchantAllowlist.length; i++) {
            address merchant = config_.merchantAllowlist[i];
            config.merchantAllowlist.push(merchant);
            allowedMerchants[merchant] = true;
        }

        for (uint256 i = 0; i < config_.successors.length; i++) {
            Successor memory successor = config_.successors[i];
            config.successors.push(
                Successor({
                    agent: successor.agent,
                    priority: successor.priority,
                    active: successor.active
                })
            );
            successorPriority[successor.agent] = successor.priority;
            successorActive[successor.agent] = successor.active;
        }

        authority = AuthorityState({
            currentAgent: config_.primaryAgent,
            status: MissionStatus.ACTIVE,
            agentNonce: 0,
            stateVersion: 0,
            violationCount: 0,
            lastViolationAt: 0,
            confirmedSpentAtomic: 0,
            lastCheckpointHash: bytes32(0),
            lastCheckpointSequence: 0
        });

        emit MissionCreated(owner_, address(this), config_.policyHash);
        emit AgentAuthorized(config_.primaryAgent, 1, 0);
        for (uint256 i = 0; i < config_.successors.length; i++) {
            emit AgentAuthorized(config_.successors[i].agent, 2, 0);
        }
    }

    /// @notice Cancels a mission. Funds remain in the owner's wallet.
    /// @dev Expiry is enforced as a guard. On-chain EXPIRED is reserved for a
    ///      future explicit transition; Phase 1 only reaches ACTIVE/CANCELLED.
    function cancel(uint64 expectedVersion) external onlyOwner {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();

        MissionStatus previous = authority.status;
        if (
            previous != MissionStatus.ACTIVE &&
            previous != MissionStatus.ACTIVE_RECOVERY &&
            previous != MissionStatus.QUARANTINED &&
            previous != MissionStatus.RECOVERING
        ) {
            revert InvalidStatus();
        }
        if (block.timestamp >= config.expiresAt) revert InvalidExpiry();

        authority.status = MissionStatus.CANCELLED;
        authority.stateVersion = expectedVersion + 1;

        emit MissionStatusChanged(previous, MissionStatus.CANCELLED, authority.stateVersion);
        emit MissionCancelled(owner, authority.stateVersion);
    }

    /// @notice Authorizes one HSP Payment Mandate. Callable by anyone holding a
    ///         valid agent signature; typically the Succra runtime.
    /// @dev The mandate hash is already an EIP-712 digest, so no EIP-191 prefix
    ///      is applied. confirmedSpentAtomic is not updated here; Phase 3
    ///      recordSettlement updates it after HSP/chain confirmation. The
    ///      stateVersion guard serializes payment authorizations so only one
    ///      payment per mission can be in flight with a given expected version.
    function authorizePayment(
        PaymentAuthorization calldata auth,
        uint64 expectedVersion
    ) external {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }
        if (auth.agent != authority.currentAgent) revert NotCurrentAgent();
        if (block.timestamp >= auth.expiresAt) revert InvalidExpiry();
        if (block.timestamp >= config.expiresAt) revert InvalidExpiry();
        if (usedRequestIds[auth.requestId]) revert RequestAlreadyUsed();
        if (auth.paymentNonce <= authority.agentNonce) revert InvalidNonce();
        if (!allowedMerchants[auth.merchant]) revert InvalidMerchant();
        if (auth.token != config.paymentToken) revert InvalidToken();

        uint256 ceiling = authority.status == MissionStatus.ACTIVE
            ? config.maxPaymentAtomic
            : config.recoveryMaxPaymentAtomic;
        if (auth.amountAtomic > ceiling) revert InvalidAmount();
        if (authority.confirmedSpentAtomic + auth.amountAtomic > config.budgetAtomic) {
            revert InvalidAmount();
        }

        (address recovered, ECDSA.RecoverError recoverError, ) = ECDSA.tryRecoverCalldata(
            auth.mandateHash,
            auth.agentSignature
        );
        if (recoverError != ECDSA.RecoverError.NoError || recovered != auth.agent) {
            revert InvalidSignature();
        }

        usedRequestIds[auth.requestId] = true;
        authorizedRequests[auth.requestId] = true;
        authorizedAmount[auth.requestId] = auth.amountAtomic;
        authority.agentNonce = auth.paymentNonce;
        authority.stateVersion = expectedVersion + 1;

        emit PaymentAuthorized(
            auth.requestId,
            auth.merchant,
            auth.amountAtomic,
            auth.mandateHash
        );
    }

    /// @notice Mirrors one HSP/HashKey-confirmed settlement into mission state.
    /// @dev Guardian-only. The contract cannot verify HSP settlement itself, so
    ///      the guardian is the trusted reporting role. The payment must have
    ///      been authorized by this mission with exactly the same amount, and
    ///      each payment may be recorded only once. No funds move here.
    function recordSettlement(
        bytes32 paymentId,
        uint256 amountAtomic,
        bytes32 txHash,
        uint64 expectedVersion
    ) external onlyGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }
        if (!authorizedRequests[paymentId]) revert NotAuthorized();
        if (authorizedAmount[paymentId] != amountAtomic) revert AmountMismatch();
        if (recordedSettlements[paymentId]) revert AlreadyRecorded();
        if (authority.confirmedSpentAtomic + amountAtomic > config.budgetAtomic) {
            revert InvalidAmount();
        }

        recordedSettlements[paymentId] = true;
        authority.confirmedSpentAtomic += amountAtomic;
        authority.stateVersion = expectedVersion + 1;

        emit PaymentSettlementRecorded(paymentId, amountAtomic, txHash);
    }

    /// @notice The live global guardian from GuardianRegistry.
    function guardian() external view returns (address) {
        return guardianRegistry.guardian();
    }

    function getMerchantAllowlist() external view returns (address[] memory) {
        return config.merchantAllowlist;
    }

    function getSuccessors() external view returns (Successor[] memory) {
        return config.successors;
    }

    function _validateConfig(MissionConfig memory candidate) internal view {
        if (
            candidate.budgetAtomic == 0 ||
            candidate.maxPaymentAtomic == 0 ||
            candidate.maxPaymentAtomic > candidate.budgetAtomic
        ) {
            revert InvalidAmount();
        }
        if (
            candidate.recoveryMaxPaymentAtomic == 0 ||
            candidate.recoveryMaxPaymentAtomic > candidate.maxPaymentAtomic
        ) {
            revert InvalidAmount();
        }
        if (candidate.expiresAt <= block.timestamp) revert InvalidExpiry();
        if (candidate.primaryAgent == address(0)) revert ZeroAddress();
        if (candidate.violationThreshold == 0) revert InvalidViolationThreshold();
        if (candidate.violationWindowSeconds == 0) revert InvalidViolationWindow();
        if (candidate.merchantAllowlist.length == 0) revert InvalidMerchant();

        for (uint256 i = 0; i < candidate.merchantAllowlist.length; i++) {
            address merchant = candidate.merchantAllowlist[i];
            if (merchant == address(0)) revert InvalidMerchant();
            for (uint256 j = 0; j < i; j++) {
                if (candidate.merchantAllowlist[j] == merchant) revert InvalidMerchant();
            }
        }

        if (candidate.successors.length > 8) revert SuccessorLimitExceeded();
        for (uint256 i = 0; i < candidate.successors.length; i++) {
            address agent = candidate.successors[i].agent;
            if (agent == address(0)) revert InvalidSuccessor();
            if (agent == candidate.primaryAgent) revert PrimaryAgentInSuccessors();
            for (uint256 j = 0; j < i; j++) {
                if (candidate.successors[j].agent == agent) revert SuccessorAlreadyExists();
            }
        }
    }
}
