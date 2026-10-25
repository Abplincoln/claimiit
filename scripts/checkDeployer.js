import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkDeployer() {
  const envPath = path.join(__dirname, "../.env");
  const envExists = fs.existsSync(envPath);

  console.log("=== DEPLOYMENT READINESS CHECK ===");
  console.log(`.env file exists: ${envExists}`);

  if (!envExists) {
    console.log("STATUS: .env file is missing.");
    return { ready: false, reason: "MISSING_ENV_FILE" };
  }

  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawKey || rawKey.trim() === "") {
    console.log("STATUS: DEPLOYER_PRIVATE_KEY is not configured in .env.");
    return { ready: false, reason: "MISSING_PRIVATE_KEY" };
  }

  const formattedKey = rawKey.trim().startsWith("0x") ? rawKey.trim() : `0x${rawKey.trim()}`;

  let wallet;
  try {
    const provider = new ethers.JsonRpcProvider("https://rpc.bohr.life");
    wallet = new ethers.Wallet(formattedKey, provider);
  } catch (err) {
    console.log(`STATUS: Invalid private key format (${err.message}).`);
    return { ready: false, reason: "INVALID_KEY_FORMAT" };
  }

  // Verify Network
  const provider = wallet.provider;
  let network;
  try {
    network = await provider.getNetwork();
  } catch (err) {
    console.log(`STATUS: Failed to reach BOT Chain Bohr Testnet RPC (${err.message}).`);
    return { ready: false, reason: "RPC_UNREACHABLE" };
  }

  const chainId = Number(network.chainId);
  console.log(`Configured RPC: https://rpc.bohr.life`);
  console.log(`Verified Chain ID: ${chainId} (Expected: 968)`);

  if (chainId !== 968) {
    console.log("STATUS: ABORT - Connected network chain ID does not match Bohr Testnet 968.");
    return { ready: false, reason: "WRONG_NETWORK" };
  }

  // Derive Deployer Public Address
  const deployerAddress = wallet.address;
  console.log(`Deployer Public Address: ${deployerAddress}`);

  // Check Balance
  const balance = await provider.getBalance(deployerAddress);
  const formattedBalance = ethers.formatEther(balance);
  console.log(`Deployer Testnet Balance: ${formattedBalance} BOHR`);

  if (balance === 0n) {
    console.log("STATUS: Deployer account has 0 gas balance on BOT Chain Bohr Testnet.");
    return { ready: false, reason: "ZERO_BALANCE", deployerAddress, balance: formattedBalance };
  }

  console.log("STATUS: READY FOR DEPLOYMENT");
  return { ready: true, deployerAddress, balance: formattedBalance, chainId };
}

checkDeployer().catch((err) => {
  console.error("Check failed:", err.message);
  process.exit(1);
});
