import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import hre from "hardhat";

const { ethers } = hre;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("==================================================");
  console.log("CLAIMIIT — BOT CHAIN BOHR TESTNET DEPLOYMENT");
  console.log("==================================================");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Target Network Chain ID: ${chainId}`);

  // Hardhat local is 31337; BOT Chain Bohr Testnet is 968
  if (chainId !== 968 && chainId !== 31337) {
    throw new Error(`ABORT: Expected Bohr Testnet (968) or Hardhat (31337), but connected to chain ${chainId}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("ABORT: No deployer signer available. Ensure DEPLOYER_PRIVATE_KEY is set in .env.");
  }

  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log(`Deployer Address: ${deployerAddress}`);
  console.log(`Deployer Balance: ${ethers.formatEther(balance)} native tokens\n`);

  if (balance === 0n && chainId === 968) {
    throw new Error(
      `ABORT: Deployer account ${deployerAddress} has 0 balance on BOT Chain Bohr Testnet.\n` +
      `Please acquire testnet tokens from https://faucet.botchain.ai/basic before deploying.`
    );
  }

  // Load Merkle proof data
  const proofsPath = path.join(__dirname, "../data/proofs.json");
  if (!fs.existsSync(proofsPath)) {
    throw new Error("ABORT: data/proofs.json not found. Run 'node scripts/generateMerkle.js' first.");
  }
  const proofsData = JSON.parse(fs.readFileSync(proofsPath, "utf-8"));
  console.log(`Merkle Root to configure: ${proofsData.merkleRoot}`);

  // 1. Deploy TestERC20
  console.log("\n[1/5] Deploying TestERC20 token...");
  const TestERC20Factory = await ethers.getContractFactory("TestERC20", deployer);
  const testToken = await TestERC20Factory.deploy();
  await testToken.waitForDeployment();
  const testTokenAddress = await testToken.getAddress();
  const testTokenTxHash = testToken.deploymentTransaction()?.hash;
  console.log(`  TestERC20 deployed at: ${testTokenAddress}`);
  console.log(`  Tx Hash: ${testTokenTxHash}`);

  // 2. Deploy Claimiit
  console.log("\n[2/5] Deploying Claimiit smart contract...");
  const ClaimiitFactory = await ethers.getContractFactory("Claimiit", deployer);
  const claimiit = await ClaimiitFactory.deploy(testTokenAddress);
  await claimiit.waitForDeployment();
  const claimiitAddress = await claimiit.getAddress();
  const claimiitTxHash = claimiit.deploymentTransaction()?.hash;
  console.log(`  Claimiit deployed at: ${claimiitAddress}`);
  console.log(`  Tx Hash: ${claimiitTxHash}`);

  // 3. Configure Merkle Root (Once)
  console.log("\n[3/5] Configuring on-chain Merkle root...");
  const setRootTx = await claimiit.setMerkleRoot(proofsData.merkleRoot);
  const setRootReceipt = await setRootTx.wait();
  console.log(`  Merkle root set in tx: ${setRootTx.hash} (Status: ${setRootReceipt.status})`);

  // 4. Mint Demonstration Tokens
  const totalAllocatedCDT = 850n;
  const mintAmount = ethers.parseUnits("1000", 18);
  const fundAmount = ethers.parseUnits(totalAllocatedCDT.toString(), 18);

  console.log("\n[4/5] Minting demonstration tokens...");
  const mintTx = await testToken.mint(deployerAddress, mintAmount);
  await mintTx.wait();
  console.log(`  Minted 1,000 CDT to deployer in tx: ${mintTx.hash}`);

  // 5. Fund Claimiit Contract
  console.log(`\n[5/5] Funding Claimiit contract with ${totalAllocatedCDT} CDT...`);
  const transferTx = await testToken.transfer(claimiitAddress, fundAmount);
  await transferTx.wait();
  console.log(`  Transferred ${totalAllocatedCDT} CDT in tx: ${transferTx.hash}`);

  // On-chain verification
  console.log("\n--- On-Chain Verification ---");
  const onChainToken = await claimiit.token();
  const onChainRoot = await claimiit.merkleRoot();
  const onChainRootConfigured = await claimiit.rootConfigured();
  const onChainContractBalance = await testToken.balanceOf(claimiitAddress);

  console.log(`  Token address matches:  ${onChainToken === testTokenAddress}`);
  console.log(`  Root matches:           ${onChainRoot === proofsData.merkleRoot}`);
  console.log(`  Root configured:        ${onChainRootConfigured}`);
  console.log(`  Contract CDT Balance:   ${ethers.formatUnits(onChainContractBalance, 18)} CDT`);

  if (!onChainRootConfigured || onChainContractBalance < fundAmount) {
    throw new Error("ABORT: On-chain state verification failed!");
  }

  // Save deployment records
  const deploymentRecord = {
    network: chainId === 968 ? "BOT Chain Bohr Testnet" : "Hardhat Local",
    chainId: chainId,
    rpcUrl: chainId === 968 ? "https://rpc.bohr.life" : "http://localhost:8545",
    explorerUrl: chainId === 968 ? "https://scan.bohr.life" : "",
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      TestERC20: {
        address: testTokenAddress,
        deploymentTxHash: testTokenTxHash,
      },
      Claimiit: {
        address: claimiitAddress,
        deploymentTxHash: claimiitTxHash,
      },
    },
    merkleRoot: proofsData.merkleRoot,
    transactions: {
      testTokenDeploy: testTokenTxHash,
      claimiitDeploy: claimiitTxHash,
      setMerkleRoot: setRootTx.hash,
      mint: mintTx.hash,
      fundContract: transferTx.hash,
    },
    funding: {
      fundedAmountCDT: totalAllocatedCDT.toString(),
      contractBalanceBaseUnits: onChainContractBalance.toString(),
    },
  };

  const deploymentPath = path.join(__dirname, "../data/deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentRecord, null, 2));
  console.log(`\nSaved deployment record to: data/deployment.json`);

  // Write frontend .env.local
  const frontendEnvLocalPath = path.join(__dirname, "../frontend/.env.local");
  const envLocalContent = `# Generated by deploy.js on ${new Date().toISOString()}
VITE_CLAIMIIT_CONTRACT_ADDRESS=${claimiitAddress}
VITE_TEST_TOKEN_ADDRESS=${testTokenAddress}
VITE_CHAIN_ID=${chainId}
VITE_RPC_URL=${chainId === 968 ? "https://rpc.bohr.life" : "http://localhost:8545"}
VITE_EXPLORER_URL=${chainId === 968 ? "https://scan.bohr.life" : ""}
`;
  fs.writeFileSync(frontendEnvLocalPath, envLocalContent);
  console.log(`Configured frontend: frontend/.env.local`);

  console.log("==================================================");
  console.log("DEPLOYMENT COMPLETE & VERIFIED");
  console.log("==================================================");

  return deploymentRecord;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
