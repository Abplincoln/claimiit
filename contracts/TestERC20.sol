// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestERC20
 * @notice Demonstration ERC-20 token for Claimiit MVP testing on BOT Chain Bohr Testnet.
 */
contract TestERC20 is ERC20, Ownable {
    /**
     * @notice Initializes the demonstration token with symbol CDT and 18 decimals.
     */
    constructor() ERC20("Claimiit Demo Token", "CDT") Ownable(msg.sender) {}

    /**
     * @notice Mints demonstration tokens. Restricted to contract owner.
     * @param to Recipient address
     * @param amount Token amount to mint in base units
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
