export const CLAIMIIT_FACTORY_ABI = [
  "function createCampaign(tuple(address token, bytes32 merkleRoot, string name, string description, uint256 totalAllocation, uint256 recipientCount, uint256 endTime) params) external returns (address campaignAddress)",
  "function getAllCampaigns() external view returns (address[])",
  "function getOrganizerCampaigns(address organizer) external view returns (address[])",
  "function totalCampaigns() external view returns (uint256)",
  "function totalOrganizerCampaigns(address organizer) external view returns (uint256)",
  "event CampaignCreated(address indexed campaignAddress, address indexed organizer, address token, bytes32 merkleRoot, uint256 totalAllocation, uint256 recipientCount, uint256 endTime, string name)"
];

export const CLAIMIIT_CAMPAIGN_ABI = [
  "function token() external view returns (address)",
  "function merkleRoot() external view returns (bytes32)",
  "function totalAllocation() external view returns (uint256)",
  "function recipientCount() external view returns (uint256)",
  "function endTime() external view returns (uint256)",
  "function name() external view returns (string)",
  "function description() external view returns (string)",
  "function owner() external view returns (address)",
  "function hasClaimed(address account) external view returns (bool)",
  "function claim(uint256 amount, bytes32[] calldata merkleProof) external",
  "function withdrawRemaining(address to) external",
  "function getSummary() external view returns (address tokenAddress, bytes32 root, uint256 totalAlloc, uint256 recipients, uint256 expiresAt, uint256 balance, bool isEnded)",
  "event Claimed(address indexed claimant, uint256 amount)",
  "event RemainingWithdrawn(address indexed organizer, address indexed to, uint256 amount)"
];

export const CLAIMIIT_ABI = [
  "function token() view returns (address)",
  "function merkleRoot() view returns (bytes32)",
  "function rootConfigured() view returns (bool)",
  "function hasClaimed(address) view returns (bool)",
  "function claim(uint256 amount, bytes32[] calldata merkleProof) external",
  "event Claimed(address indexed claimant, uint256 amount)",
  "event MerkleRootConfigured(bytes32 indexed merkleRoot)",
  "error TokenAddressZero()",
  "error InvalidRoot()",
  "error RootNotConfigured()",
  "error RootAlreadyConfigured()",
  "error AlreadyClaimed()",
  "error InvalidProof()"
];

export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];
