import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import hre from "hardhat";

const { ethers } = hre;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("==================================================");
  console.log("CLAIMIIT — MULTI-CAMPAIGN FACTORY DEPLOYMENT");
  console.log("==================================================");

  // 1. Verify Network
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Connected Network Chain ID: ${chainId}`);

  // BOT Chain Bohr Testnet is 968; Hardhat local simulation is 31337
  if (chainId !== 968 && chainId !== 31337) {
    throw new Error(`ABORT: Expected Bohr Testnet (968) or Hardhat local (31337), but connected to chain ${chainId}. Refusing to proceed.`);
  }

  // 2. Derive Signer & Check Gas Balance (Never log or print private keys)
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("ABORT: No deployer signer available. Ensure DEPLOYER_PRIVATE_KEY is set in .env.");
  }

  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log(`Deployer Public Address: ${deployerAddress}`);
  console.log(`Deployer Gas Balance:    ${ethers.formatEther(balance)} native tokens\n`);

  if (balance === 0n && chainId === 968) {
    throw new Error(`ABORT: Deployer account ${deployerAddress} has 0 balance on BOT Chain Bohr Testnet.`);
  }

  // 3. Deploy ClaimiitFactory
  console.log("[1/3] Deploying ClaimiitFactory contract...");
  const FactoryContract = await ethers.getContractFactory("ClaimiitFactory", deployer);
  // ClaimiitFactory takes no constructor arguments
  const factory = await FactoryContract.deploy();
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  const deployTx = factory.deploymentTransaction();
  const txHash = deployTx?.hash;

  console.log(`  ClaimiitFactory deployed at: ${factoryAddress}`);
  console.log(`  Deployment Tx Hash:          ${txHash}`);

  // 4. Verify On-Chain Initial State
  console.log("\n[2/3] Verifying factory on-chain state...");
  const initialTotal = await factory.totalCampaigns();
  const allCampaigns = await factory.getAllCampaigns();
  console.log(`  Initial total campaigns: ${initialTotal.toString()}`);
  console.log(`  All campaigns array len: ${allCampaigns.length}`);

  if (initialTotal !== 0n || allCampaigns.length !== 0) {
    throw new Error("ABORT: Factory initialization state check failed!");
  }

  // 5. Update Deployment Records & Frontend Config (Preserving Legacy Addresses)
  console.log("\n[3/3] Updating deployment records while preserving legacy deployments...");
  const deploymentPath = path.join(__dirname, "../data/deployment.json");
  let deploymentData = {};
  if (fs.existsSync(deploymentPath)) {
    try {
      deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
    } catch {
      deploymentData = {};
    }
  }

  deploymentData.network = chainId === 968 ? "BOT Chain Bohr Testnet" : "Hardhat Local";
  deploymentData.chainId = chainId;
  deploymentData.rpcUrl = chainId === 968 ? "https://rpc.bohr.life" : "http://localhost:8545";
  deploymentData.explorerUrl = chainId === 968 ? "https://scan.bohr.life" : "";
  deploymentData.updatedAt = new Date().toISOString();

  // Preserve existing legacy contracts
  deploymentData.contracts = deploymentData.contracts || {};
  deploymentData.contracts.ClaimiitFactory = {
    address: factoryAddress,
    deploymentTxHash: txHash,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`  Updated deployment records at: data/deployment.json`);

  // Update frontend/.env.local with factory address while preserving legacy Claimiit and CDT addresses
  const frontendEnvPath = path.join(__dirname, "../frontend/.env.local");
  const legacyClaimiit = deploymentData.contracts.Claimiit?.address || "0xc98B13d6ae131be797Eb62725Dd7c9CD42121dAe";
  const legacyToken = deploymentData.contracts.TestERC20?.address || "0x7Afa063DE43648d612a61eD40CB0D289f68bD0bA";

  const frontendEnvContent = `# Generated/Updated by deployFactory.js on ${new Date().toISOString()}
VITE_CLAIMIIT_FACTORY_ADDRESS=${factoryAddress}
VITE_CLAIMIIT_CONTRACT_ADDRESS=${legacyClaimiit}
VITE_TEST_TOKEN_ADDRESS=${legacyToken}
VITE_CHAIN_ID=${chainId === 968 ? 968 : 31337}
VITE_RPC_URL=${chainId === 968 ? "https://rpc.bohr.life" : "http://localhost:8545"}
VITE_EXPLORER_URL=${chainId === 968 ? "https://scan.bohr.life" : ""}
`;
  fs.writeFileSync(frontendEnvPath, frontendEnvContent);
  console.log(`  Updated frontend config at: frontend/.env.local`);

  console.log("\n==================================================");
  console.log("CLAIMIIT FACTORY DEPLOYMENT COMPLETED SUCCESSFULLY");
  console.log(`Factory Address: ${factoryAddress}`);
  console.log("==================================================");

  return {
    factoryAddress,
    txHash,
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDeployment failed:", err.message || err);
    process.exit(1);
  });
