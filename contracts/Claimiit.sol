// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Claimiit
 * @notice Merkle-proof-based token claiming smart contract for Claimiit MVP.
 */
contract Claimiit is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public merkleRoot;
    bool public rootConfigured;

    mapping(address => bool) public hasClaimed;

    event MerkleRootConfigured(bytes32 indexed merkleRoot);
    event Claimed(address indexed claimant, uint256 amount);

    error TokenAddressZero();
    error InvalidRoot();
    error RootNotConfigured();
    error RootAlreadyConfigured();
    error AlreadyClaimed();
    error InvalidProof();

    /**
     * @param _token Address of the ERC-20 token to distribute
     */
    constructor(address _token) Ownable(msg.sender) {
        if (_token == address(0)) {
            revert TokenAddressZero();
        }
        token = IERC20(_token);
    }

    /**
     * @notice Sets the Merkle root. Can only be called once by the owner.
     * @param _merkleRoot The root hash of the standard Merkle tree.
     */
    function setMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        if (rootConfigured) {
            revert RootAlreadyConfigured();
        }
        if (_merkleRoot == bytes32(0)) {
            revert InvalidRoot();
        }

        merkleRoot = _merkleRoot;
        rootConfigured = true;

        emit MerkleRootConfigured(_merkleRoot);
    }

    /**
     * @notice Claim allocated tokens using a Merkle proof.
     * @param amount The claimant's allocated token amount in base units.
     * @param merkleProof Merkle proof verifying allocation.
     */
    function claim(uint256 amount, bytes32[] calldata merkleProof) external nonReentrant {
        if (!rootConfigured) {
            revert RootNotConfigured();
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
}
