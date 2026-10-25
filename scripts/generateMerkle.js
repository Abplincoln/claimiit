import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateMerkle() {
  const allocationsPath = path.join(__dirname, "../data/allocations.json");
  const rawData = fs.readFileSync(allocationsPath, "utf-8");
  const allocations = JSON.parse(rawData);

  console.log("==================================================");
  console.log("CLAIMIIT — MERKLE TREE GENERATION UTILITY");
  console.log("==================================================");
  console.log("[NOTE] This script generates demonstration Merkle proofs.");
  console.log("[NOTE] Generating a proof does NOT mean a claim has occurred on-chain.\n");

  // Format leaves: [address, amountInBaseUnits]
  const values = allocations.map((item) => [
    item.address,
    ethers.parseUnits(item.amount, 18).toString(),
  ]);

  // Construct StandardMerkleTree using exact ABI types ["address", "uint256"]
  const tree = StandardMerkleTree.of(values, ["address", "uint256"]);

  console.log(`Merkle Root: ${tree.root}`);
  console.log(`Total Eligible Allocations: ${values.length}\n`);

  const proofsData = {
    merkleRoot: tree.root,
    tokenDecimals: 18,
    generatedAt: new Date().toISOString(),
    notice: "Demonstration proofs only. No on-chain claims have been executed.",
    claims: [],
  };

  for (const [i, v] of tree.entries()) {
    const proof = tree.getProof(i);
    const originalItem = allocations[i];

    proofsData.claims.push({
      index: i,
      description: originalItem.description,
      address: v[0],
      amountTokens: originalItem.amount,
      amountBaseUnits: v[1],
      proof: proof,
    });

    console.log(`--- Allocation #${i + 1} ---`);
    console.log(`  Description: ${originalItem.description}`);
    console.log(`  Address:     ${v[0]}`);
    console.log(`  Amount:      ${originalItem.amount} CDT (${v[1]} base units)`);
    console.log(`  Proof:       ${JSON.stringify(proof)}`);
    console.log("");
  }

  // Save tree dump and proofs data for consumption
  const treeDumpPath = path.join(__dirname, "../data/merkleTree.json");
  fs.writeFileSync(treeDumpPath, JSON.stringify(tree.dump(), null, 2));

  const proofsPath = path.join(__dirname, "../data/proofs.json");
  fs.writeFileSync(proofsPath, JSON.stringify(proofsData, null, 2));

  const frontendProofsPath = path.join(__dirname, "../frontend/src/data/proofs.json");
  if (fs.existsSync(path.dirname(frontendProofsPath))) {
    fs.writeFileSync(frontendProofsPath, JSON.stringify(proofsData, null, 2));
  }

  console.log(`Saved Merkle tree dump to: data/merkleTree.json`);
  console.log(`Saved proof details to:    data/proofs.json & frontend/src/data/proofs.json`);
  console.log("==================================================");

  return { root: tree.root, tree, proofsData };
}

// Execute if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateMerkle();
}

export { generateMerkle };
