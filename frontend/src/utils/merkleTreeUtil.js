import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ethers } from "ethers";

/**
 * Builds an OpenZeppelin StandardMerkleTree from parsed recipients.
 * Exact leaf format: ["address", "uint256"] -> double-hashed keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
 * 
 * @param {Array<{ address: string, amountTokens: string, amountBaseUnits: string }>} recipients
 * @returns {{ root: string, tree: any, claims: Array }}
 */
export function buildCampaignMerkleTree(recipients) {
  if (!recipients || recipients.length === 0) {
    throw new Error("Cannot build Merkle tree: recipients list is empty.");
  }

  const values = recipients.map((r) => [r.address, r.amountBaseUnits]);
  const tree = StandardMerkleTree.of(values, ["address", "uint256"]);

  const claims = [];
  for (const [i, v] of tree.entries()) {
    const proof = tree.getProof(i);
    const original = recipients[i];
    claims.push({
      index: i,
      address: v[0],
      amountTokens: original ? original.amountTokens : ethers.formatUnits(v[1], 18),
      amountBaseUnits: v[1],
      proof: proof,
    });
  }

  return {
    root: tree.root,
    tree,
    claims,
  };
}

/**
 * Creates a downloadable campaign backup JSON payload.
 */
export function createCampaignBackupPayload({
  campaignAddress = "",
  campaignName,
  campaignDescription = "",
  tokenAddress,
  tokenSymbol = "CDT",
  tokenDecimals = 18,
  totalAllocationBaseUnits,
  recipientCount,
  endTime,
  merkleRoot,
  claims,
}) {
  return {
    version: "1.0.0",
    network: "BOT Chain Bohr Testnet",
    chainId: 968,
    campaignAddress,
    campaignName,
    campaignDescription,
    tokenAddress,
    tokenSymbol,
    tokenDecimals,
    totalAllocationBaseUnits: totalAllocationBaseUnits.toString(),
    totalTokens: ethers.formatUnits(totalAllocationBaseUnits, tokenDecimals),
    recipientCount,
    endTime,
    merkleRoot,
    claims,
    exportedAt: new Date().toISOString(),
    notice: "Claimiit campaign backup payload. Contains precomputed Merkle proofs for eligibility restoration.",
  };
}

/**
 * Validates an imported campaign backup JSON file and verifies its proofs against the Merkle root.
 * 
 * @param {string|object} backupData 
 * @param {string} [expectedOnChainRoot] Optional on-chain root to verify against
 * @returns {{ valid: boolean, backup: object|null, error: string|null }}
 */
export function validateImportedBackup(backupData, expectedOnChainRoot = null) {
  let parsed;
  try {
    parsed = typeof backupData === "string" ? JSON.parse(backupData) : backupData;
  } catch (err) {
    return { valid: false, backup: null, error: `Invalid JSON syntax: ${err.message}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, backup: null, error: "Backup file is not a valid JSON object." };
  }

  if (!parsed.merkleRoot || typeof parsed.merkleRoot !== "string" || !parsed.merkleRoot.startsWith("0x")) {
    return { valid: false, backup: null, error: "Missing or invalid merkleRoot in backup." };
  }

  if (expectedOnChainRoot && parsed.merkleRoot.toLowerCase() !== expectedOnChainRoot.toLowerCase()) {
    return {
      valid: false,
      backup: null,
      error: `Merkle root mismatch. Backup root (${parsed.merkleRoot}) does not match on-chain campaign root (${expectedOnChainRoot}).`,
    };
  }

  if (!Array.isArray(parsed.claims) || parsed.claims.length === 0) {
    return { valid: false, backup: null, error: "Backup contains no recipient claims data." };
  }

  // Verify each claim in the backup cryptographically against the root
  for (let i = 0; i < parsed.claims.length; i++) {
    const claim = parsed.claims[i];
    if (!claim.address || !ethers.isAddress(claim.address)) {
      return { valid: false, backup: null, error: `Claim index ${i} has invalid address "${claim.address}".` };
    }
    if (!claim.amountBaseUnits || typeof claim.amountBaseUnits !== "string") {
      return { valid: false, backup: null, error: `Claim index ${i} has invalid amountBaseUnits.` };
    }
    if (!Array.isArray(claim.proof)) {
      return { valid: false, backup: null, error: `Claim index ${i} has invalid proof array.` };
    }

    const isValidProof = StandardMerkleTree.verify(
      parsed.merkleRoot,
      ["address", "uint256"],
      [claim.address, claim.amountBaseUnits],
      claim.proof
    );

    if (!isValidProof) {
      return { valid: false, backup: null, error: `Cryptographic verification failed for claim index ${i} (${claim.address}). Proof does not match root.` };
    }
  }

  return {
    valid: true,
    backup: parsed,
    error: null,
  };
}
