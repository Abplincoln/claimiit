// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @notice Configuration parameters for a ClaimiitCampaign.
 */
struct CampaignParams {
    address token;
    bytes32 merkleRoot;
    string name;
    string description;
    uint256 totalAllocation;
    uint256 recipientCount;
    uint256 endTime;
}

/**
 * @title ClaimiitCampaign
 * @notice Independent token reward distribution campaign with an immutable Merkle root.
 */
contract ClaimiitCampaign is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    uint256 public immutable totalAllocation;
    uint256 public immutable recipientCount;
    uint256 public immutable endTime;

    string public name;
    string public description;

    mapping(address => bool) public hasClaimed;

    event Claimed(address indexed claimant, uint256 amount);
    event RemainingWithdrawn(address indexed organizer, address indexed to, uint256 amount);

    error OrganizerAddressZero();
    error TokenAddressZero();
    error InvalidRoot();
    error TotalAllocationZero();
    error RecipientCountZero();
    error InvalidEndTime();
    error CampaignEnded();
    error CampaignStillActive();
    error AlreadyClaimed();
    error InvalidProof();
    error NothingToWithdraw();
    error InvalidRecipient();

    /**
     * @param _organizer Address of the campaign creator/owner
     * @param params Campaign initialization parameters
     */
    constructor(
        address _organizer,
        CampaignParams memory params
    ) Ownable(_organizer) {
        if (_organizer == address(0)) {
            revert OrganizerAddressZero();
        }
        if (params.token == address(0)) {
            revert TokenAddressZero();
        }
        if (params.merkleRoot == bytes32(0)) {
            revert InvalidRoot();
        }
        if (params.totalAllocation == 0) {
            revert TotalAllocationZero();
        }
        if (params.recipientCount == 0) {
            revert RecipientCountZero();
        }
        if (params.endTime <= block.timestamp) {
            revert InvalidEndTime();
        }

        token = IERC20(params.token);
        merkleRoot = params.merkleRoot;
        name = params.name;
        description = params.description;
        totalAllocation = params.totalAllocation;
        recipientCount = params.recipientCount;
        endTime = params.endTime;
    }

    /**
     * @notice Claim allocated tokens using a Merkle proof.
     * @param amount The claimant's allocated token amount in base units.
     * @param merkleProof Merkle proof verifying allocation against root.
     */
    function claim(uint256 amount, bytes32[] calldata merkleProof) external nonReentrant {
        if (block.timestamp >= endTime) {
            revert CampaignEnded();
        }
        if (hasClaimed[msg.sender]) {
            revert AlreadyClaimed();
        }

        // Standard OpenZeppelin MerkleTree leaf format: double-hashed abi.encode(address, uint256)
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));

        if (!MerkleProof.verify(merkleProof, merkleRoot, leaf)) {
            revert InvalidProof();
        }

        hasClaimed[msg.sender] = true;

        token.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, amount);
    }

    /**
     * @notice Withdraw undistributed tokens back to the organizer after the campaign has ended.
     * @dev Only callable by the organizer strictly after endTime.
     * @param to Recipient address for the remaining tokens
     */
    function withdrawRemaining(address to) external onlyOwner nonReentrant {
        if (block.timestamp < endTime) {
            revert CampaignStillActive();
        }
        if (to == address(0)) {
            revert InvalidRecipient();
        }

        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) {
            revert NothingToWithdraw();
        }

        token.safeTransfer(to, balance);

        emit RemainingWithdrawn(msg.sender, to, balance);
    }

    /**
     * @notice Helper to fetch complete campaign metrics in a single RPC read.
     */
    function getSummary()
        external
        view
        returns (
            address tokenAddress,
            bytes32 root,
            uint256 totalAlloc,
            uint256 recipients,
            uint256 expiresAt,
            uint256 balance,
            bool isEnded
        )
    {
        return (
            address(token),
            merkleRoot,
            totalAllocation,
            recipientCount,
            endTime,
            token.balanceOf(address(this)),
            block.timestamp >= endTime
        );
    }
}
