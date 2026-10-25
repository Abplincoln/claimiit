import { expect } from "chai";
import hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const { ethers } = hre;

describe("Claimiit MVP Contract Suite", function () {
  let owner;
  let claimant1;
  let claimant2;
  let claimant3;
  let ineligibleUser;

  let testToken;
  let claimiit;

  let tree;
  let root;

  const allocation1 = ethers.parseUnits("100", 18);
  const allocation2 = ethers.parseUnits("250", 18);
  const allocation3 = ethers.parseUnits("500", 18);

  beforeEach(async function () {
    [owner, claimant1, claimant2, claimant3, ineligibleUser] = await ethers.getSigners();

    // 1. Deploy TestERC20 demonstration token
    const TestERC20Factory = await ethers.getContractFactory("TestERC20");
    testToken = await TestERC20Factory.deploy();
    await testToken.waitForDeployment();

    // 2. Deploy Claimiit contract
    const ClaimiitFactory = await ethers.getContractFactory("Claimiit");
    claimiit = await ClaimiitFactory.deploy(await testToken.getAddress());
    await claimiit.waitForDeployment();

    // 3. Mint tokens to owner and fund the Claimiit contract with 1,000 CDT
    const totalFunding = ethers.parseUnits("1000", 18);
    await testToken.mint(owner.address, totalFunding);
    await testToken.transfer(await claimiit.getAddress(), totalFunding);

    // 4. Construct Merkle tree using StandardMerkleTree ["address", "uint256"]
    const values = [
      [claimant1.address, allocation1.toString()],
      [claimant2.address, allocation2.toString()],
      [claimant3.address, allocation3.toString()],
    ];
    tree = StandardMerkleTree.of(values, ["address", "uint256"]);
    root = tree.root;
  });

  describe("Deployment & Initial State", function () {
    it("should set the token address correctly", async function () {
      expect(await claimiit.token()).to.equal(await testToken.getAddress());
    });

    it("should reject deployment with zero token address", async function () {
      const ClaimiitFactory = await ethers.getContractFactory("Claimiit");
      await expect(ClaimiitFactory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        claimiit,
        "TokenAddressZero"
      );
    });

    it("should have rootConfigured set to false initially", async function () {
      expect(await claimiit.rootConfigured()).to.be.false;
      expect(await claimiit.merkleRoot()).to.equal(ethers.ZeroHash);
    });
  });

  describe("Root Configuration Restrictions", function () {
    it("should reject claims before the root is configured", async function () {
      const proof1 = tree.getProof(0);
      await expect(
        claimiit.connect(claimant1).claim(allocation1, proof1)
      ).to.be.revertedWithCustomError(claimiit, "RootNotConfigured");
    });

    it("should reject root configuration by a non-owner", async function () {
      await expect(
        claimiit.connect(claimant1).setMerkleRoot(root)
      ).to.be.revertedWithCustomError(claimiit, "OwnableUnauthorizedAccount");
    });

    it("should reject configuring an empty / zero root", async function () {
      await expect(
        claimiit.connect(owner).setMerkleRoot(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(claimiit, "InvalidRoot");
    });

    it("should allow the owner to configure the root once and emit MerkleRootConfigured", async function () {
      await expect(claimiit.connect(owner).setMerkleRoot(root))
        .to.emit(claimiit, "MerkleRootConfigured")
        .withArgs(root);

      expect(await claimiit.rootConfigured()).to.be.true;
      expect(await claimiit.merkleRoot()).to.equal(root);
    });

    it("should reject a second root configuration attempt by the owner", async function () {
      await claimiit.connect(owner).setMerkleRoot(root);

      const fakeRoot = ethers.keccak256(ethers.toUtf8Bytes("fake-root"));
      await expect(
        claimiit.connect(owner).setMerkleRoot(fakeRoot)
      ).to.be.revertedWithCustomError(claimiit, "RootAlreadyConfigured");
    });
  });

  describe("Claim Verification and Token Distribution", function () {
    beforeEach(async function () {
      await claimiit.connect(owner).setMerkleRoot(root);
    });

    it("should allow an eligible claimant to claim and receive exact token amount", async function () {
      const proof1 = tree.getProof(0);
      const initialContractBalance = await testToken.balanceOf(await claimiit.getAddress());
      const initialClaimantBalance = await testToken.balanceOf(claimant1.address);

      expect(initialClaimantBalance).to.equal(0n);

      await claimiit.connect(claimant1).claim(allocation1, proof1);

      const finalClaimantBalance = await testToken.balanceOf(claimant1.address);
      const finalContractBalance = await testToken.balanceOf(await claimiit.getAddress());

      expect(finalClaimantBalance).to.equal(allocation1);
      expect(finalContractBalance).to.equal(initialContractBalance - allocation1);
      expect(await claimiit.hasClaimed(claimant1.address)).to.be.true;
    });

    it("should emit Claimed event with correct address and allocation amount", async function () {
      const proof2 = tree.getProof(1);
      await expect(claimiit.connect(claimant2).claim(allocation2, proof2))
        .to.emit(claimiit, "Claimed")
        .withArgs(claimant2.address, allocation2);
    });

    it("should reject duplicate claim for the same allocation", async function () {
      const proof1 = tree.getProof(0);
      await claimiit.connect(claimant1).claim(allocation1, proof1);

      await expect(
        claimiit.connect(claimant1).claim(allocation1, proof1)
      ).to.be.revertedWithCustomError(claimiit, "AlreadyClaimed");
    });

    it("should reject claim with an invalid proof", async function () {
      const invalidProof = [ethers.keccak256(ethers.toUtf8Bytes("corrupted-proof-hash"))];
      await expect(
        claimiit.connect(claimant3).claim(allocation3, invalidProof)
      ).to.be.revertedWithCustomError(claimiit, "InvalidProof");
    });

    it("should reject claim with valid proof but tampered amount", async function () {
      const proof3 = tree.getProof(2);
      const tamperedAmount = ethers.parseUnits("9999", 18);
      await expect(
        claimiit.connect(claimant3).claim(tamperedAmount, proof3)
      ).to.be.revertedWithCustomError(claimiit, "InvalidProof");
    });

    it("should reject claim from an ineligible address not in the Merkle tree", async function () {
      const proof1 = tree.getProof(0);
      await expect(
        claimiit.connect(ineligibleUser).claim(allocation1, proof1)
      ).to.be.revertedWithCustomError(claimiit, "InvalidProof");
    });

    it("should verify and execute claims for all 3 committed sample allocations using generated proofs", async function () {
      // Import committed proofs
      const proofsData = (await import("../data/proofs.json", { with: { type: "json" } })).default;

      // Deploy a fresh contract with the committed proofs root
      const ClaimiitFactory = await ethers.getContractFactory("Claimiit");
      const sampleClaimiit = await ClaimiitFactory.deploy(await testToken.getAddress());
      await sampleClaimiit.waitForDeployment();

      // Fund with 1,000 CDT directly
      await testToken.mint(await sampleClaimiit.getAddress(), ethers.parseUnits("1000", 18));

      // Configure root once with committed Merkle root
      await sampleClaimiit.connect(owner).setMerkleRoot(proofsData.merkleRoot);

      // Verify each of the 3 committed claims using impersonated signers
      for (const claim of proofsData.claims) {
        // Fund impersonated account with ETH for gas
        await ethers.provider.send("hardhat_setBalance", [
          claim.address,
          "0x1000000000000000000", // 1 ETH
        ]);

        const claimantSigner = await ethers.getImpersonatedSigner(claim.address);
        const amountBaseUnits = BigInt(claim.amountBaseUnits);

        await expect(
          sampleClaimiit.connect(claimantSigner).claim(amountBaseUnits, claim.proof)
        )
          .to.emit(sampleClaimiit, "Claimed")
          .withArgs(claim.address, amountBaseUnits);

        expect(await testToken.balanceOf(claim.address)).to.equal(amountBaseUnits);
        expect(await sampleClaimiit.hasClaimed(claim.address)).to.be.true;
      }
    });
  });
});
