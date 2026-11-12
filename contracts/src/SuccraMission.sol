// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC1271} from '@openzeppelin/contracts/interfaces/IERC1271.sol';
import {GuardianRegistry} from './GuardianRegistry.sol';

/// @title SuccraMission
/// @notice Authoritative mission authority, policy, custody, and session key for one Succra mission.
/// @dev Mission funds are held by this contract. Variant A exposes ERC-1271 so the
///      contract can be the EIP-3009 `from`; Variant B releases exact amounts to a
///      session key that signs EIP-3009 directly. The owner retains an unconditional
///      withdrawal right.
contract SuccraMission is IERC1271 {
    struct Successor {
        address agent;
        uint16 priority; // lower wins
        bool active;
    }

    struct MissionConfig {
        address paymentToken;
        uint256 budgetAtomic;
        uint256 initialDepositAtomic;
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

    /// @notice Reason a treasury transfer was blocked by mission policy.
    enum TreasuryBlockReason {
        ZERO_AMOUNT,
        TOKEN_NOT_ALLOWED,
        MERCHANT_NOT_ALLOWED,
        CAP_EXCEEDED,
        BUDGET_EXCEEDED,
        INSUFFICIENT_BALANCE
    }

    struct AuthorityState {
        address currentAgent;
        MissionStatus status;
        uint64 agentNonce;
        uint64 stateVersion;
        uint16 violationCount;
        uint64 lastViolationAt;
        uint256 confirmedSpentAtomic;
        address sessionKey;
        uint256 depositedAtomic;
        uint256 withdrawnAtomic;
        uint256 reservedAtomic;
        uint256 releasedAtomic;
        bytes32 lastCheckpointHash;
        uint64 lastCheckpointSequence;
        uint64 checkpointCount;
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
    error ViolationAlreadyRecorded();
    error AlreadyQuarantined();
    error NotActiveSuccessor();
    error CannotReactivatePrimary();
    error NotInRecovering();
    error InvalidAcknowledgement();
    error ZeroAddress();
    error InsufficientBalance();
    error SessionKeyNotSet();
    error HashAlreadyApproved();
    error HashNotApproved();
    error NotFunded();

    event MissionCreated(address indexed owner, address indexed mission, bytes32 policyHash);
    event PolicyUpdated(bytes32 indexed policyHash, uint64 stateVersion);
    event AgentAuthorized(address indexed agent, uint8 role, uint64 stateVersion);
    event AgentRevoked(address indexed agent, uint64 stateVersion);
    event FundsDeposited(address indexed owner, uint256 amount);
    event FundsWithdrawn(address indexed owner, uint256 amount);
    event SessionKeyRegistered(address indexed sessionKey, uint64 stateVersion);
    event SessionKeyRevoked(address indexed sessionKey, uint64 stateVersion);
    event PaymentApproved(
        bytes32 indexed authorizationHash,
        uint256 amount,
        address merchant
    );
    event PaymentReleased(address indexed sessionKey, uint256 amount);
    event TreasuryTransfer(
        address indexed token,
        address indexed to,
        uint256 amountAtomic,
        uint64 stateVersion
    );
    event TreasuryTransferBlocked(
        address indexed token,
        address indexed to,
        uint256 amountAtomic,
        TreasuryBlockReason reason,
        bytes32 indexed requestId,
        uint16 violationCount,
        uint64 stateVersion
    );
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
    mapping(bytes32 => bool) public recordedViolations;
    mapping(uint64 => bytes32) public checkpoints;
    mapping(address => bool) public allowedMerchants;
    mapping(address => uint16) public successorPriority;
    mapping(address => bool) public successorActive;
    mapping(bytes32 => bool) public approvedHashes;
    mapping(bytes32 => uint256) public approvedAmount;

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

    /// @dev Manual quarantine is owner- or guardian-authorized. The owner may
    ///      quarantine at any time; the guardian may also quarantine when the
    ///      runtime crosses the configured violation threshold.
    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner && msg.sender != guardianRegistry.guardian()) {
            revert NotGuardian();
        }
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
        config.initialDepositAtomic = config_.initialDepositAtomic;
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
            sessionKey: address(0),
            depositedAtomic: 0,
            withdrawnAtomic: 0,
            reservedAtomic: 0,
            releasedAtomic: 0,
            lastCheckpointHash: bytes32(0),
            lastCheckpointSequence: 0,
            checkpointCount: 0
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

        address previousKey = authority.sessionKey;
        authority.sessionKey = address(0);
        authority.status = MissionStatus.CANCELLED;
        authority.stateVersion = expectedVersion + 1;

        emit SessionKeyRevoked(previousKey, authority.stateVersion);
        emit MissionStatusChanged(previous, MissionStatus.CANCELLED, authority.stateVersion);
        emit MissionCancelled(owner, authority.stateVersion);
    }

    /// @notice Deposits the mission settlement token into the vault.
    /// @dev Owner-only. The owner must approve this contract on the token first.
    function deposit(uint256 amountAtomic) external onlyOwner {
        if (amountAtomic == 0) revert InvalidAmount();
        if (!IERC20(config.paymentToken).transferFrom(msg.sender, address(this), amountAtomic)) {
            revert InsufficientBalance();
        }
        authority.depositedAtomic += amountAtomic;
        emit FundsDeposited(msg.sender, amountAtomic);
    }

    /// @notice Withdraws unallocated mission funds. Always available to the owner.
    /// @dev Approved/released/settled amounts are not withdrawable twice.
    function withdraw(uint256 amountAtomic) external onlyOwner {
        if (amountAtomic == 0) revert InvalidAmount();
        if (amountAtomic > availableBalance()) revert InsufficientBalance();
        authority.withdrawnAtomic += amountAtomic;
        if (!IERC20(config.paymentToken).transfer(msg.sender, amountAtomic)) {
            revert InsufficientBalance();
        }
        emit FundsWithdrawn(msg.sender, amountAtomic);
    }

    /// @notice Executes a policy-bounded ERC-20 treasury transfer.
    /// @dev Used for assets such as WIF that do not implement EIP-3009. The
    ///      runtime (guardian) submits the transfer after off-chain policy
    ///      evaluation; this contract independently enforces the token,
    ///      merchant, per-payment ceiling, cumulative budget, and available
    ///      balance. Policy failures increment the violation streak instead of
    ///      reverting so the blocked attempt remains observable on-chain.
    function executeERC20Transfer(
        address token,
        address to,
        uint256 amountAtomic
    ) external onlyGuardian returns (bool) {
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }
        if (amountAtomic == 0) {
            return
                _blockTreasuryTransfer(
                    token,
                    to,
                    amountAtomic,
                    TreasuryBlockReason.ZERO_AMOUNT
                );
        }
        if (token != config.paymentToken) {
            return
                _blockTreasuryTransfer(
                    token,
                    to,
                    amountAtomic,
                    TreasuryBlockReason.TOKEN_NOT_ALLOWED
                );
        }
        if (!allowedMerchants[to]) {
            return
                _blockTreasuryTransfer(
                    token,
                    to,
                    amountAtomic,
                    TreasuryBlockReason.MERCHANT_NOT_ALLOWED
                );
        }

        uint256 ceiling = authority.status == MissionStatus.ACTIVE
            ? config.maxPaymentAtomic
            : config.recoveryMaxPaymentAtomic;
        if (amountAtomic > ceiling) {
            return
                _blockTreasuryTransfer(
                    token,
                    to,
                    amountAtomic,
                    TreasuryBlockReason.CAP_EXCEEDED
                );
        }
        if (
            authority.confirmedSpentAtomic +
                authority.reservedAtomic +
                authority.releasedAtomic +
                amountAtomic >
            config.budgetAtomic
        ) {
            return
                _blockTreasuryTransfer(
                    token,
                    to,
                    amountAtomic,
                    TreasuryBlockReason.BUDGET_EXCEEDED
                );
        }
        if (amountAtomic > availableBalance()) {
            return
                _blockTreasuryTransfer(
                    token,
                    to,
                    amountAtomic,
                    TreasuryBlockReason.INSUFFICIENT_BALANCE
                );
        }

        // Checks-effects-interactions: update mission accounting before the
        // external token call. A false/reverting token result rolls this back.
        authority.confirmedSpentAtomic += amountAtomic;
        authority.violationCount = 0;
        authority.lastViolationAt = 0;
        authority.stateVersion += 1;

        if (!IERC20(token).transfer(to, amountAtomic)) {
            revert InsufficientBalance();
        }

        emit TreasuryTransfer(token, to, amountAtomic, authority.stateVersion);
        return true;
    }

    /// @notice Registers or replaces the runtime-held session key.
    function registerSessionKey(address sessionKey_, uint64 expectedVersion) external onlyOwner {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (sessionKey_ == address(0)) revert ZeroAddress();
        authority.sessionKey = sessionKey_;
        authority.stateVersion = expectedVersion + 1;
        emit SessionKeyRegistered(sessionKey_, authority.stateVersion);
    }

    /// @notice Revokes the session key. Owner at any time; guardian on quarantine.
    function revokeSessionKey(uint64 expectedVersion) external onlyOwnerOrGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        _revokeSessionKey(expectedVersion);
    }

    /// @notice Variant A: approves one EIP-3009 authorization hash for ERC-1271.
    /// @dev Runtime/guardian-submitted after the agent request passes off-chain
    ///      policy. The contract records the hash, amount, and merchant; the
    ///      session key's EIP-3009 signature is checked by isValidSignature.
    function approvePayment(
        bytes32 authorizationHash,
        uint256 amountAtomic,
        address merchant,
        uint64 expectedVersion
    ) external onlyGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }
        if (authority.sessionKey == address(0)) revert SessionKeyNotSet();
        if (authority.depositedAtomic < config.initialDepositAtomic) revert NotFunded();
        if (!allowedMerchants[merchant]) revert InvalidMerchant();
        if (approvedHashes[authorizationHash]) revert HashAlreadyApproved();

        uint256 ceiling = authority.status == MissionStatus.ACTIVE
            ? config.maxPaymentAtomic
            : config.recoveryMaxPaymentAtomic;
        if (amountAtomic > ceiling) revert InvalidAmount();
        if (
            authority.confirmedSpentAtomic +
                authority.reservedAtomic +
                authority.releasedAtomic +
                amountAtomic >
            config.budgetAtomic
        ) {
            revert InvalidAmount();
        }
        if (amountAtomic > availableBalance()) revert InsufficientBalance();

        approvedHashes[authorizationHash] = true;
        approvedAmount[authorizationHash] = amountAtomic;
        authority.reservedAtomic += amountAtomic;
        authority.stateVersion = expectedVersion + 1;

        emit PaymentApproved(authorizationHash, amountAtomic, merchant);
    }

    /// @notice Variant B: releases the exact approved amount to the session key.
    /// @dev Intended after approvePayment for the same amount. The session key
    ///      then signs EIP-3009 with from=sessionKey.
    function releaseForPayment(
        address sessionKey_,
        uint256 amountAtomic,
        uint64 expectedVersion
    ) external onlyGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }
        if (authority.sessionKey == address(0)) revert SessionKeyNotSet();
        if (authority.sessionKey != sessionKey_) revert NotAuthorized();
        if (authority.depositedAtomic < config.initialDepositAtomic) revert NotFunded();
        if (amountAtomic > IERC20(config.paymentToken).balanceOf(address(this))) {
            revert InsufficientBalance();
        }

        if (authority.reservedAtomic >= amountAtomic) {
            authority.reservedAtomic -= amountAtomic;
        }
        authority.releasedAtomic += amountAtomic;
        authority.stateVersion = expectedVersion + 1;
        if (!IERC20(config.paymentToken).transfer(sessionKey_, amountAtomic)) {
            revert InsufficientBalance();
        }

        emit PaymentReleased(sessionKey_, amountAtomic);
    }

    /// @notice ERC-1271 entry point used by USDG/WIF when the contract is `from`.
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4) {
        if (!approvedHashes[hash] || authority.sessionKey == address(0)) {
            return 0xffffffff;
        }
        (address recovered, ECDSA.RecoverError recoverError, ) = ECDSA.tryRecover(
            hash,
            signature
        );
        if (recoverError != ECDSA.RecoverError.NoError || recovered != authority.sessionKey) {
            return 0xffffffff;
        }
        return 0x1626ba7e;
    }

    /// @notice Unallocated token balance available to the owner.
    function availableBalance() public view returns (uint256) {
        uint256 committed = authority.confirmedSpentAtomic +
            authority.reservedAtomic +
            authority.releasedAtomic;
        if (committed >= authority.depositedAtomic) return 0;
        return authority.depositedAtomic - committed;
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

        (address recovered, ECDSA.RecoverError recoverError, ) = ECDSA.tryRecover(
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
        bool legacyAuthorized = authorizedRequests[paymentId];
        bool erc1271Authorized = approvedHashes[paymentId];
        if (!legacyAuthorized && !erc1271Authorized) revert NotAuthorized();
        if (legacyAuthorized && authorizedAmount[paymentId] != amountAtomic) {
            revert AmountMismatch();
        }
        if (erc1271Authorized && approvedAmount[paymentId] != amountAtomic) {
            revert AmountMismatch();
        }
        if (recordedSettlements[paymentId]) revert AlreadyRecorded();
        if (authority.confirmedSpentAtomic + amountAtomic > config.budgetAtomic) {
            revert InvalidAmount();
        }

        if (erc1271Authorized) {
            if (authority.reservedAtomic >= amountAtomic) {
                authority.reservedAtomic -= amountAtomic;
            }
            if (authority.releasedAtomic >= amountAtomic) {
                authority.releasedAtomic -= amountAtomic;
            }
        }

        recordedSettlements[paymentId] = true;
        authority.confirmedSpentAtomic += amountAtomic;
        authority.stateVersion = expectedVersion + 1;

        // FR-04: any CONFIRMED settlement resets the consecutive violation
        // streak. Both the counter and its window anchor are cleared.
        authority.violationCount = 0;
        authority.lastViolationAt = 0;

        emit PaymentSettlementRecorded(paymentId, amountAtomic, txHash);
    }

    /// @notice Records one authenticated, current-agent policy violation.
    /// @dev Guardian-only. The guardian reports off-chain preflight rejections;
    ///      the contract remains authoritative for the streak and threshold.
    ///      Violations are idempotent by request id, and a violation older than
    ///      the configured window is discarded before the next increment.
    function recordViolation(
        bytes32 requestId,
        uint64 expectedVersion
    ) external onlyGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }
        if (recordedViolations[requestId]) revert ViolationAlreadyRecorded();

        if (
            authority.lastViolationAt > 0 &&
            block.timestamp - uint256(authority.lastViolationAt) >
            uint256(config.violationWindowSeconds)
        ) {
            authority.violationCount = 0;
        }

        recordedViolations[requestId] = true;
        authority.violationCount += 1;
        authority.lastViolationAt = uint64(block.timestamp);
        authority.stateVersion = expectedVersion + 1;

        emit ViolationRecorded(requestId, authority.violationCount, authority.stateVersion);
    }

    /// @notice Manually quarantines an executable mission.
    /// @dev Owner or guardian. There is no threshold requirement: the owner can
    ///      always freeze a mission, and the guardian's automatic threshold path
    ///      calls the same method. Quarantine does not move funds.
    function quarantine(uint64 expectedVersion) external onlyOwnerOrGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (authority.status == MissionStatus.QUARANTINED) revert AlreadyQuarantined();
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }

        MissionStatus previous = authority.status;
        address previousKey = authority.sessionKey;
        authority.sessionKey = address(0);
        authority.status = MissionStatus.QUARANTINED;
        authority.stateVersion = expectedVersion + 1;

        emit SessionKeyRevoked(previousKey, authority.stateVersion);
        emit MissionStatusChanged(previous, MissionStatus.QUARANTINED, authority.stateVersion);
        emit MissionQuarantined(msg.sender, authority.stateVersion);
    }

    /// @notice Commits one verified checkpoint hash.
    /// @dev Guardian-only. Sequences are strict: 0, 1, 2, ... matching
    ///      checkpointCount. The full snapshot lives off-chain; this contract
    ///      stores only the hash commitment.
    function commitCheckpoint(
        uint64 sequence,
        bytes32 checkpointHash,
        uint64 expectedVersion
    ) external onlyGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (
            authority.status != MissionStatus.ACTIVE &&
            authority.status != MissionStatus.ACTIVE_RECOVERY
        ) {
            revert InvalidStatus();
        }
        if (sequence != authority.checkpointCount) revert InvalidVersion();

        checkpoints[sequence] = checkpointHash;
        authority.lastCheckpointHash = checkpointHash;
        authority.lastCheckpointSequence = sequence;
        authority.checkpointCount = sequence + 1;
        authority.stateVersion = expectedVersion + 1;

        emit CheckpointCommitted(sequence, checkpointHash);
    }

    /// @notice Activates a caller-supplied, pre-approved successor.
    /// @dev Guardian-only. Eligibility (capabilities, availability, priority)
    ///      is the off-chain runtime's decision; the contract only verifies
    ///      membership and the active flag. From RECOVERING a different
    ///      successor may be tried; the previous pending activation is
    ///      replaced implicitly by the currentAgent update.
    function activateSuccessor(
        address successor,
        uint64 expectedVersion
    ) external onlyGuardian {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (
            authority.status != MissionStatus.QUARANTINED &&
            authority.status != MissionStatus.RECOVERING
        ) {
            revert InvalidStatus();
        }
        if (!isActiveSuccessor(successor)) revert NotActiveSuccessor();
        if (successor == authority.currentAgent) revert CannotReactivatePrimary();

        MissionStatus previous = authority.status;
        address previousKey = authority.sessionKey;
        authority.currentAgent = successor;
        authority.status = MissionStatus.RECOVERING;
        authority.sessionKey = address(0);
        authority.agentNonce = 0;
        authority.stateVersion = expectedVersion + 1;

        emit SessionKeyRevoked(previousKey, authority.stateVersion);
        emit SuccessorActivated(successor, authority.lastCheckpointHash, authority.stateVersion);
        emit MissionStatusChanged(previous, MissionStatus.RECOVERING, authority.stateVersion);
    }

    /// @notice Acknowledges recovery and moves RECOVERING to ACTIVE_RECOVERY.
    /// @dev The current agent may call directly. The guardian may submit on the
    ///      successor's behalf with an EIP-712/raw digest signature over
    ///      keccak256(abi.encode("succra.recovery.ack.v1", address(this),
    ///      expectedVersion)).
    function acknowledgeRecovery(
        uint64 expectedVersion,
        bytes calldata signature
    ) external {
        if (expectedVersion != authority.stateVersion) revert InvalidVersion();
        if (authority.status != MissionStatus.RECOVERING) revert NotInRecovering();

        if (msg.sender != authority.currentAgent) {
            if (msg.sender != guardianRegistry.guardian()) revert NotAuthorized();
            bytes32 digest = recoveryAckDigest(expectedVersion);
            (address recovered, ECDSA.RecoverError recoverError, ) = ECDSA.tryRecover(
                digest,
                signature
            );
            if (
                recoverError != ECDSA.RecoverError.NoError ||
                recovered != authority.currentAgent
            ) {
                revert InvalidAcknowledgement();
            }
        }

        authority.status = MissionStatus.ACTIVE_RECOVERY;
        authority.stateVersion = expectedVersion + 1;

        emit RecoveryAcknowledged(authority.currentAgent, authority.stateVersion);
        emit MissionStatusChanged(
            MissionStatus.RECOVERING,
            MissionStatus.ACTIVE_RECOVERY,
            authority.stateVersion
        );
    }

    /// @notice Digest the successor signs for guardian-submitted acknowledgement.
    function recoveryAckDigest(uint64 expectedVersion) public view returns (bytes32) {
        return
            keccak256(
                abi.encode('succra.recovery.ack.v1', address(this), expectedVersion)
            );
    }

    /// @notice Whether an address is a pre-approved successor with active=true.
    function isActiveSuccessor(address successor) public view returns (bool) {
        return successorActive[successor];
    }

    /// @notice Number of pre-approved successors on this mission.
    function successorCount() external view returns (uint256) {
        return config.successors.length;
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

    /// @dev Records a blocked treasury transfer as a policy violation. The
    ///      state version changes so the runtime must refresh before retrying.
    function _blockTreasuryTransfer(
        address token,
        address to,
        uint256 amountAtomic,
        TreasuryBlockReason reason
    ) internal returns (bool) {
        if (
            authority.lastViolationAt > 0 &&
            block.timestamp - uint256(authority.lastViolationAt) >
            uint256(config.violationWindowSeconds)
        ) {
            authority.violationCount = 0;
        }

        authority.violationCount += 1;
        authority.lastViolationAt = uint64(block.timestamp);
        authority.stateVersion += 1;

        bytes32 requestId = keccak256(
            abi.encode(token, to, amountAtomic, authority.stateVersion, block.timestamp)
        );
        emit ViolationRecorded(requestId, authority.violationCount, authority.stateVersion);
        emit TreasuryTransferBlocked(
            token,
            to,
            amountAtomic,
            reason,
            requestId,
            authority.violationCount,
            authority.stateVersion
        );
        return false;
    }

    function _revokeSessionKey(uint64 expectedVersion) internal {
        address previous = authority.sessionKey;
        authority.sessionKey = address(0);
        authority.stateVersion = expectedVersion + 1;
        emit SessionKeyRevoked(previous, authority.stateVersion);
    }

    function _validateConfig(MissionConfig memory candidate) internal view {
        if (
            candidate.budgetAtomic == 0 ||
            candidate.initialDepositAtomic == 0 ||
            candidate.initialDepositAtomic > candidate.budgetAtomic ||
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
