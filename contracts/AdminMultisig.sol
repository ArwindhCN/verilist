// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AdminMultisig
/// @notice A shared admin wallet: several signers, and an action only happens when enough of them approve it
///         AND a waiting time (the "timelock") has passed. Make this contract the owner of `ProductRegistry` and
///         `ListingRegistry`, and no single person or stolen key can verify, revoke or register anyone alone.
/// @dev Written by hand so every line can be explained in the viva. It is small on purpose: the signers and the
///      thresholds are fixed at deployment, so there is no "change the signers" code to attack. To change signers,
///      deploy a new multisig and hand the registries over to it with the two-step `transferOwnership`.
///      For a real production system, a widely audited multisig such as Safe is the better choice. This contract
///      shows the idea and works with the same registries.
///
///      The timelock is the ONE place in the whole project where `block.timestamp` is used in a decision (the
///      registries only record timestamps). That is the point of a timelock, and it is limited to this contract.
///
///      Life of an action: `propose` -> signers `approve` -> once approvals reach the threshold, the timelock
///      starts -> after the delay, anyone can `execute`. While waiting, signers can `revokeApproval`; if approvals
///      fall below the threshold the action is blocked and the timelock resets.
contract AdminMultisig {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Maximum number of signers. Keeps the setup loop short and bounded.
    uint256 public constant MAX_OWNERS = 10;

    /// @notice Longest allowed timelock delay (30 days). A huge delay would make the multisig useless.
    uint256 public constant MAX_DELAY = 30 days;

    // ---------------------------------------------------------------------
    // Types and storage
    // ---------------------------------------------------------------------

    /// @notice One proposed action: "call `target` with `data`".
    /// @dev `executableAt` is 0 while approvals are below the threshold. Once the threshold is reached it is the
    ///      time from which the action may run (approval time + delay).
    struct Proposal {
        address proposer;
        address target;
        bytes data;
        uint256 approvals;
        uint64 executableAt;
        bool executed;
    }

    /// @notice How many approvals an action needs. Fixed at deployment.
    uint256 public immutable threshold;

    /// @notice Seconds to wait between "enough approvals" and "can be executed". Fixed at deployment.
    uint256 public immutable delay;

    /// @notice How many proposals have ever been made. Proposal IDs run from 1 to this number.
    uint256 public proposalCount;

    /// @notice True for every signer address.
    mapping(address => bool) public isOwner;

    /// @dev The signer addresses, in the order given at deployment (used only by `getOwners`).
    address[] private _owners;

    /// @dev Proposals by ID.
    mapping(uint256 => Proposal) private _proposals;

    /// @notice True if `owner` has approved proposal `id` (and has not withdrawn the approval).
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    // ---------------------------------------------------------------------
    // Events (every state change emits an event)
    // ---------------------------------------------------------------------

    /// @notice Emitted when a signer proposes an action. The proposer's own approval is counted at once.
    /// @param id The new proposal's ID.
    /// @param proposer The signer who proposed it.
    /// @param target The contract that will be called.
    /// @param data The encoded call (function selector and arguments).
    event ProposalCreated(uint256 indexed id, address indexed proposer, address indexed target, bytes data);

    /// @notice Emitted when a signer approves a proposal.
    /// @param id The proposal.
    /// @param signer The approving signer.
    /// @param approvals The number of approvals now.
    event ProposalApproved(uint256 indexed id, address indexed signer, uint256 approvals);

    /// @notice Emitted when a signer withdraws an approval.
    /// @param id The proposal.
    /// @param signer The signer who withdrew.
    /// @param approvals The number of approvals now.
    event ApprovalRevoked(uint256 indexed id, address indexed signer, uint256 approvals);

    /// @notice Emitted when approvals reach the threshold and the timelock starts.
    /// @param id The proposal.
    /// @param executableAt The time from which it can be executed.
    event ProposalReady(uint256 indexed id, uint256 executableAt);

    /// @notice Emitted when a proposal has been executed.
    /// @param id The proposal.
    /// @param executor Whoever triggered the execution.
    event ProposalExecuted(uint256 indexed id, address indexed executor);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice The signer list was empty.
    error NoOwners();

    /// @notice There were more than `MAX_OWNERS` signers.
    /// @param count How many were given.
    /// @param max The maximum allowed.
    error TooManyOwners(uint256 count, uint256 max);

    /// @notice A signer address was the zero address.
    error ZeroAddress();

    /// @notice The same signer address was given twice.
    /// @param owner The repeated address.
    error DuplicateOwner(address owner);

    /// @notice The threshold was 0 or higher than the number of signers.
    /// @param threshold The threshold that was given.
    /// @param owners The number of signers.
    error InvalidThreshold(uint256 threshold, uint256 owners);

    /// @notice The delay was longer than `MAX_DELAY`.
    /// @param delay The delay that was given.
    /// @param max The maximum allowed.
    error DelayTooLong(uint256 delay, uint256 max);

    /// @notice The caller is not one of the signers.
    /// @param caller The caller.
    error NotAnOwner(address caller);

    /// @notice The target of a proposal is not a contract (calling a normal wallet would "succeed" and do nothing).
    /// @param target The target that was given.
    error TargetNotAContract(address target);

    /// @notice No proposal exists with this ID.
    /// @param id The ID that was looked up.
    error ProposalNotFound(uint256 id);

    /// @notice The proposal was already executed.
    /// @param id The proposal.
    error ProposalAlreadyExecuted(uint256 id);

    /// @notice This signer already approved the proposal.
    /// @param id The proposal.
    /// @param signer The signer.
    error AlreadyApproved(uint256 id, address signer);

    /// @notice This signer has no approval on the proposal to withdraw.
    /// @param id The proposal.
    /// @param signer The signer.
    error NotApproved(uint256 id, address signer);

    /// @notice The proposal does not have enough approvals yet.
    /// @param id The proposal.
    /// @param approvals The approvals it has.
    /// @param needed The approvals it needs.
    error NotEnoughApprovals(uint256 id, uint256 approvals, uint256 needed);

    /// @notice The timelock has not finished yet.
    /// @param id The proposal.
    /// @param executableAt The time from which it can be executed.
    error TimelockNotElapsed(uint256 id, uint256 executableAt);

    /// @notice The called contract reverted without giving a reason.
    /// @param id The proposal.
    error ExecutionFailed(uint256 id);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    /// @notice Lets only a signer run the function.
    modifier onlyOwnerSigner() {
        if (!isOwner[msg.sender]) revert NotAnOwner(msg.sender);
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @notice Sets the signers, how many must approve, and the timelock delay. None of these can change later.
    /// @dev The loop is bounded by `MAX_OWNERS`. A delay of 0 means "no waiting" (useful for tests and demos).
    /// @param owners_ The signer addresses (1 to `MAX_OWNERS`, no zero address, no duplicates).
    /// @param threshold_ The number of approvals needed (1 up to the number of signers).
    /// @param delay_ Seconds to wait after enough approvals before an action can run (at most `MAX_DELAY`).
    constructor(address[] memory owners_, uint256 threshold_, uint256 delay_) {
        uint256 count = owners_.length;
        if (count == 0) revert NoOwners();
        if (count > MAX_OWNERS) revert TooManyOwners(count, MAX_OWNERS);
        if (threshold_ == 0 || threshold_ > count) revert InvalidThreshold(threshold_, count);
        if (delay_ > MAX_DELAY) revert DelayTooLong(delay_, MAX_DELAY);

        for (uint256 i = 0; i < count; i++) {
            address signer = owners_[i];
            if (signer == address(0)) revert ZeroAddress();
            if (isOwner[signer]) revert DuplicateOwner(signer);
            isOwner[signer] = true;
            _owners.push(signer);
        }

        threshold = threshold_;
        delay = delay_;
    }

    // ---------------------------------------------------------------------
    // Signer functions
    // ---------------------------------------------------------------------

    /// @notice A signer proposes an action: "call `target` with `data`". The proposer's approval counts at once.
    /// @dev Nothing runs here. The encoded call can be built off-chain, for example with ethers:
    ///      `registry.interface.encodeFunctionData("verifyBrand", [brand, "Fastrack"])`.
    /// @param target The contract to call (must be a contract).
    /// @param data The encoded function call.
    /// @return id The new proposal's ID.
    function propose(address target, bytes calldata data) external onlyOwnerSigner returns (uint256 id) {
        if (target.code.length == 0) revert TargetNotAContract(target);

        id = ++proposalCount;
        Proposal storage proposal = _proposals[id];
        proposal.proposer = msg.sender;
        proposal.target = target;
        proposal.data = data;

        emit ProposalCreated(id, msg.sender, target, data);
        _approve(id, proposal);
    }

    /// @notice A signer approves a proposal. When approvals reach the threshold, the timelock starts.
    /// @param id The proposal.
    function approve(uint256 id) external onlyOwnerSigner {
        Proposal storage proposal = _openProposal(id);
        if (hasApproved[id][msg.sender]) revert AlreadyApproved(id, msg.sender);
        _approve(id, proposal);
    }

    /// @notice A signer withdraws its approval. If approvals fall below the threshold, the action is blocked
    ///         and the timelock is reset (it starts again from zero if the threshold is reached again).
    /// @dev This is how signers cancel an action they have noticed is wrong during the waiting time.
    /// @param id The proposal.
    function revokeApproval(uint256 id) external onlyOwnerSigner {
        Proposal storage proposal = _openProposal(id);
        if (!hasApproved[id][msg.sender]) revert NotApproved(id, msg.sender);

        hasApproved[id][msg.sender] = false;
        proposal.approvals -= 1;
        if (proposal.approvals < threshold) proposal.executableAt = 0;

        emit ApprovalRevoked(id, msg.sender, proposal.approvals);
    }

    /// @notice Runs an approved proposal once the timelock has passed. Anyone may call it, because the action
    ///         has already been authorized by the signers.
    /// @dev The proposal is marked executed BEFORE the external call, so it cannot be run twice, even if the
    ///      called contract calls back. If the call reverts, everything is undone (the proposal stays open) and the
    ///      original error is passed on, so the reason is visible (for example `NotOwner` from a registry).
    /// @param id The proposal.
    function execute(uint256 id) external {
        Proposal storage proposal = _openProposal(id);
        if (proposal.executableAt == 0) revert NotEnoughApprovals(id, proposal.approvals, threshold);
        if (block.timestamp < proposal.executableAt) revert TimelockNotElapsed(id, proposal.executableAt);

        proposal.executed = true;
        emit ProposalExecuted(id, msg.sender);

        (bool success, bytes memory result) = proposal.target.call(proposal.data);
        if (!success) {
            if (result.length == 0) revert ExecutionFailed(id);
            // Pass on the called contract's own error (selector and arguments) unchanged.
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Returns the signer addresses.
    /// @return The signers, in the order given at deployment.
    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    /// @notice Returns a proposal. Reverts `ProposalNotFound` for an unknown ID.
    /// @param id The proposal.
    /// @return The proposal record.
    function getProposal(uint256 id) external view returns (Proposal memory) {
        if (id == 0 || id > proposalCount) revert ProposalNotFound(id);
        return _proposals[id];
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /// @dev Loads a proposal that exists and has not been executed yet.
    function _openProposal(uint256 id) internal view returns (Proposal storage proposal) {
        if (id == 0 || id > proposalCount) revert ProposalNotFound(id);
        proposal = _proposals[id];
        if (proposal.executed) revert ProposalAlreadyExecuted(id);
    }

    /// @dev Records the caller's approval. If this one reaches the threshold, the timelock starts.
    function _approve(uint256 id, Proposal storage proposal) internal {
        hasApproved[id][msg.sender] = true;
        proposal.approvals += 1;
        emit ProposalApproved(id, msg.sender, proposal.approvals);

        if (proposal.approvals == threshold) {
            proposal.executableAt = uint64(block.timestamp + delay);
            emit ProposalReady(id, proposal.executableAt);
        }
    }
}
