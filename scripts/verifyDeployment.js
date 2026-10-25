import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyLiveDeployment() {
  console.log("==================================================");
  console.log("CLAIMIIT — LIVE ON-CHAIN DEPLOYMENT VERIFICATION");
  console.log("==================================================");

  const rpcUrl = "https://rpc.bohr.life";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // 1. Verify Network Chain ID
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`1. Network Chain ID: ${chainId} (Expected: 968) -> ${chainId === 968 ? "PASSED" : "FAILED"}`);

  // Load deployment record
  const deploymentPath = path.join(__dirname, "../data/deployment.json");
  const deploymentRecord = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));

  const tokenAddress = deploymentRecord.contracts.TestERC20.address;
  const claimiitAddress = deploymentRecord.contracts.Claimiit.address;

  console.log(`\n2. Target Addresses:`);
  console.log(`   Token Contract:    ${tokenAddress}`);
  console.log(`   Claimiit Contract: ${claimiitAddress}`);

  // 2. Verify bytecode exists at both addresses
  const tokenCode = await provider.getCode(tokenAddress);
  const claimiitCode = await provider.getCode(claimiitAddress);
  console.log(`   Token code exists:    ${tokenCode !== "0x" ? "PASSED (contract deployed)" : "FAILED (no code)"}`);
  console.log(`   Claimiit code exists: ${claimiitCode !== "0x" ? "PASSED (contract deployed)" : "FAILED (no code)"}`);

  // 3. Verify Token Details (symbol, decimals, balance)
  const tokenAbi = [
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
  ];
  const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, provider);

  const symbol = await tokenContract.symbol();
  const name = await tokenContract.name();
  const decimals = Number(await tokenContract.decimals());
  const contractTokenBalance = await tokenContract.balanceOf(claimiitAddress);
  const formattedBalance = ethers.formatUnits(contractTokenBalance, decimals);

  console.log(`\n3. Token Contract Verification:`);
  console.log(`   Token Name:     "${name}"`);
  console.log(`   Token Symbol:   "${symbol}" (Expected: "CDT") -> ${symbol === "CDT" ? "PASSED" : "FAILED"}`);
  console.log(`   Decimals:       ${decimals} (Expected: 18) -> ${decimals === 18 ? "PASSED" : "FAILED"}`);
  console.log(`   Claimiit Bal:   ${formattedBalance} CDT (Expected: 850.0 CDT) -> ${formattedBalance === "850.0" ? "PASSED" : "FAILED"}`);

  // 4. Verify Claimiit Contract State
  const claimiitAbi = [
    "function token() view returns (address)",
    "function merkleRoot() view returns (bytes32)",
    "function rootConfigured() view returns (bool)",
    "function hasClaimed(address) view returns (bool)",
  ];
  const claimiitContract = new ethers.Contract(claimiitAddress, claimiitAbi, provider);

  const onChainToken = await claimiitContract.token();
  const onChainRoot = await claimiitContract.merkleRoot();
  const rootConfigured = await claimiitContract.rootConfigured();

  // Load proofs data & tree dump
  const proofsData = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/proofs.json"), "utf-8"));
  const treeDump = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/merkleTree.json"), "utf-8"));

  console.log(`\n4. Claimiit Contract State:`);
  console.log(`   Configured Token: ${onChainToken} -> ${onChainToken.toLowerCase() === tokenAddress.toLowerCase() ? "PASSED" : "FAILED"}`);
  console.log(`   Root Configured:  ${rootConfigured} -> ${rootConfigured === true ? "PASSED" : "FAILED"}`);
  console.log(`   On-chain Root:    ${onChainRoot}`);
  console.log(`   Expected Root:    ${proofsData.merkleRoot}`);
  console.log(`   Root Matches:     ${onChainRoot === proofsData.merkleRoot && onChainRoot === deploymentRecord.merkleRoot ? "PASSED" : "FAILED"}`);

  // 5. Verify Deployment Transaction Receipts
  console.log(`\n5. Deployment Transaction Receipts:`);
  const txHashes = [
    { label: "Token Deploy", hash: deploymentRecord.transactions.testTokenDeploy },
    { label: "Claimiit Deploy", hash: deploymentRecord.transactions.claimiitDeploy },
    { label: "Set Merkle Root", hash: deploymentRecord.transactions.setMerkleRoot },
    { label: "Mint Tokens", hash: deploymentRecord.transactions.mint },
    { label: "Fund Contract", hash: deploymentRecord.transactions.fundContract },
  ];

  for (const item of txHashes) {
    const receipt = await provider.getTransactionReceipt(item.hash);
    const status = receipt ? (receipt.status === 1 ? "SUCCESS (status 1)" : "FAILED (status 0)") : "NOT_FOUND";
    const blockNumber = receipt ? receipt.blockNumber : "N/A";
    console.log(`   ${item.label.padEnd(16)}: ${item.hash} | Block: ${blockNumber} | ${status}`);
  }

  // 6. Verify Allocation and Merkle Proof for 0x4093dAfCC3f60B5491C6Cd694f07F03fDA86919a
  const claimantAddress = "0x4093dAfCC3f60B5491C6Cd694f07F03fDA86919a";
  console.log(`\n6. Claimant Allocation & Proof Verification (${claimantAddress}):`);

  const claimInfo = proofsData.claims.find((c) => c.address.toLowerCase() === claimantAddress.toLowerCase());
  if (!claimInfo) {
    console.log(`   FAILED: Wallet ${claimantAddress} not found in proofs.json!`);
  } else {
    console.log(`   Found in proofs.json: Allocation = ${claimInfo.amountTokens} CDT (${claimInfo.amountBaseUnits} base units)`);
    console.log(`   Proof elements (${claimInfo.proof.length}): ${JSON.stringify(claimInfo.proof)}`);

    // Verify proof against StandardMerkleTree
    const tree = StandardMerkleTree.load(treeDump);
    let proofValidInTree = false;
    for (const [i, v] of tree.entries()) {
      if (v[0].toLowerCase() === claimantAddress.toLowerCase()) {
        const proof = tree.getProof(i);
        proofValidInTree = StandardMerkleTree.verify(tree.root, ["address", "uint256"], v, proof);
        break;
      }
    }
    console.log(`   Off-chain StandardMerkleTree verification: ${proofValidInTree ? "PASSED (Valid Proof)" : "FAILED"}`);

    // Verify leaf calculation matching Solidity: keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(abiCoder.encode(["address", "uint256"], [claimantAddress, claimInfo.amountBaseUnits]));
    const leaf = ethers.keccak256(innerHash);
    console.log(`   Computed Merkle leaf: ${leaf}`);

    // Check on-chain hasClaimed
    const hasClaimed = await claimiitContract.hasClaimed(claimantAddress);
    console.log(`   On-chain hasClaimed:  ${hasClaimed} (${hasClaimed ? "Already Claimed" : "Ready to Claim"})`);
  }

  console.log("==================================================");
}

verifyLiveDeployment().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
