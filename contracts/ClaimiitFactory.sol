// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./ClaimiitCampaign.sol";

/**
 * @title ClaimiitFactory
 * @notice Factory registry that deploys and tracks independent ClaimiitCampaign instances.
 */
contract ClaimiitFactory {
    address[] public allCampaigns;
    mapping(address => address[]) public organizerCampaigns;

    event CampaignCreated(
        address indexed campaignAddress,
        address indexed organizer,
        address token,
        bytes32 merkleRoot,
        uint256 totalAllocation,
        uint256 recipientCount,
        uint256 endTime,
        string name
    );

    /**
     * @notice Deploys a new ClaimiitCampaign contract with immutable Merkle root and parameters.
     * @param params Campaign initialization parameters packaged in CampaignParams struct
     * @return campaignAddress The address of the deployed ClaimiitCampaign
     */
    function createCampaign(
        CampaignParams calldata params
    ) external returns (address campaignAddress) {
        ClaimiitCampaign newCampaign = new ClaimiitCampaign(
            msg.sender,
            params
        );

        campaignAddress = address(newCampaign);

        allCampaigns.push(campaignAddress);
        organizerCampaigns[msg.sender].push(campaignAddress);

        emit CampaignCreated(
            campaignAddress,
            msg.sender,
            params.token,
            params.merkleRoot,
            params.totalAllocation,
            params.recipientCount,
            params.endTime,
            params.name
        );
    }

    /**
     * @notice Returns total number of campaigns created across the platform.
     */
    function totalCampaigns() external view returns (uint256) {
        return allCampaigns.length;
    }

    /**
     * @notice Returns total number of campaigns created by a specific organizer.
     * @param organizer Address of the organizer
     */
    function totalOrganizerCampaigns(address organizer) external view returns (uint256) {
        return organizerCampaigns[organizer].length;
    }

    /**
     * @notice Returns array of all deployed campaign addresses.
     */
    function getAllCampaigns() external view returns (address[] memory) {
        return allCampaigns;
    }

    /**
     * @notice Returns array of campaign addresses created by a specific organizer.
     * @param organizer Address of the organizer
     */
    function getOrganizerCampaigns(address organizer) external view returns (address[] memory) {
        return organizerCampaigns[organizer];
    }
}
