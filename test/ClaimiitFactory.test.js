import { expect } from "chai";
import hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const { ethers } = hre;

describe("Claimiit Multi-Campaign Suite (Factory & Campaigns)", function () {
  let organizer1;
  let organizer2;
  let claimant1;
  let claimant2;
  let ineligibleUser;

  let testToken;
  let factory;

  let tree;
  let root;

  const allocation1 = ethers.parseUnits("100", 18);
  const allocation2 = ethers.parseUnits("200", 18);
  const totalAlloc = ethers.parseUnits("300", 18);
  const recipientCount = 2n;

  // Helper to get future timestamp
  async function getFutureTimestamp(secondsFromNow = 3600) {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + secondsFromNow;
  }

  beforeEach(async function () {
    [organizer1, organizer2, claimant1, claimant2, ineligibleUser] = await ethers.getSigners();

    // Deploy Demo Token
    const TestERC20Factory = await ethers.getContractFactory("TestERC20");
    testToken = await TestERC20Factory.deploy();
    await testToken.waitForDeployment();

    // Deploy Factory
    const Factory = await ethers.getContractFactory("ClaimiitFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    // Build Merkle Tree
    const values = [
      [claimant1.address, allocation1.toString()],
      [claimant2.address, allocation2.toString()],
    ];
    tree = StandardMerkleTree.of(values, ["address", "uint256"]);
    root = tree.root;
  });

  describe("Factory Deployment & Initial State", function () {
    it("should deploy with zero initial campaigns", async function () {
      expect(await factory.totalCampaigns()).to.equal(0n);
      expect(await factory.getAllCampaigns()).to.deep.equal([]);
      expect(await factory.getOrganizerCampaigns(organizer1.address)).to.deep.equal([]);
      expect(await factory.totalOrganizerCampaigns(organizer1.address)).to.equal(0n);
    });
  });

  describe("Campaign Creation via Factory", function () {
    it("should deploy a new campaign and emit CampaignCreated event", async function () {
      const endTime = await getFutureTimestamp(86400); // 1 day
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Community Rewards Drop",
        description: "Rewards for early testnet contributors",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime,
      };

      const tx = await factory.connect(organizer1).createCampaign(params);
      const receipt = await tx.wait();

      expect(await factory.totalCampaigns()).to.equal(1n);
      const allCampaigns = await factory.getAllCampaigns();
      expect(allCampaigns.length).to.equal(1);

      const campaignAddress = allCampaigns[0];
      expect(await factory.getOrganizerCampaigns(organizer1.address)).to.deep.equal([campaignAddress]);
      expect(await factory.totalOrganizerCampaigns(organizer1.address)).to.equal(1n);

      // Verify CampaignCreated event
      await expect(tx)
        .to.emit(factory, "CampaignCreated")
        .withArgs(
          campaignAddress,
          organizer1.address,
          params.token,
          params.merkleRoot,
          params.totalAllocation,
          params.recipientCount,
          params.endTime,
          params.name
        );
    });

    it("should track independent campaigns across multiple organizers", async function () {
      const endTime1 = await getFutureTimestamp(3600);
      const endTime2 = await getFutureTimestamp(7200);

      const params1 = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Campaign 1",
        description: "Organizer 1 Campaign",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime1,
      };
      const params2 = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Campaign 2",
        description: "Organizer 2 Campaign",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime2,
      };

      await factory.connect(organizer1).createCampaign(params1);
      await factory.connect(organizer2).createCampaign(params2);

      expect(await factory.totalCampaigns()).to.equal(2n);
      expect(await factory.totalOrganizerCampaigns(organizer1.address)).to.equal(1n);
      expect(await factory.totalOrganizerCampaigns(organizer2.address)).to.equal(1n);
    });
  });

  describe("Campaign Parameter Validation", function () {
    it("should revert if organizer is zero address", async function () {
      const CampaignFactory = await ethers.getContractFactory("ClaimiitCampaign");
      const endTime = await getFutureTimestamp(3600);
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Test",
        description: "Test",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime,
      };

      await expect(
        CampaignFactory.deploy(ethers.ZeroAddress, params)
      ).to.be.revertedWithCustomError(CampaignFactory, "OwnableInvalidOwner");
    });

    it("should revert if token address is zero", async function () {
      const endTime = await getFutureTimestamp(3600);
      const params = {
        token: ethers.ZeroAddress,
        merkleRoot: root,
        name: "Test",
        description: "Test",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime,
      };

      await expect(
        factory.connect(organizer1).createCampaign(params)
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("ClaimiitCampaign")).interface }, "TokenAddressZero");
    });

    it("should revert if merkle root is zero", async function () {
      const endTime = await getFutureTimestamp(3600);
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: ethers.ZeroHash,
        name: "Test",
        description: "Test",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime,
      };

      await expect(
        factory.connect(organizer1).createCampaign(params)
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("ClaimiitCampaign")).interface }, "InvalidRoot");
    });

    it("should revert if totalAllocation is zero", async function () {
      const endTime = await getFutureTimestamp(3600);
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Test",
        description: "Test",
        totalAllocation: 0n,
        recipientCount: recipientCount,
        endTime: endTime,
      };

      await expect(
        factory.connect(organizer1).createCampaign(params)
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("ClaimiitCampaign")).interface }, "TotalAllocationZero");
    });

    it("should revert if recipientCount is zero", async function () {
      const endTime = await getFutureTimestamp(3600);
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Test",
        description: "Test",
        totalAllocation: totalAlloc,
        recipientCount: 0n,
        endTime: endTime,
      };

      await expect(
        factory.connect(organizer1).createCampaign(params)
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("ClaimiitCampaign")).interface }, "RecipientCountZero");
    });

    it("should revert if endTime is in the past", async function () {
      const block = await ethers.provider.getBlock("latest");
      const pastEndTime = block.timestamp - 100;
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Test",
        description: "Test",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: pastEndTime,
      };

      await expect(
        factory.connect(organizer1).createCampaign(params)
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("ClaimiitCampaign")).interface }, "InvalidEndTime");
    });
  });

  describe("Claiming and Token Transfers", function () {
    let campaign;
    let campaignAddress;
    let endTime;

    beforeEach(async function () {
      endTime = await getFutureTimestamp(3600); // 1 hour
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Community Rewards",
        description: "Test Campaign",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime,
      };

      const tx = await factory.connect(organizer1).createCampaign(params);
      const receipt = await tx.wait();
      campaignAddress = (await factory.getAllCampaigns())[0];

      const CampaignFactory = await ethers.getContractFactory("ClaimiitCampaign");
      campaign = CampaignFactory.attach(campaignAddress);

      // Organizer mints tokens and funds the campaign
      await testToken.mint(organizer1.address, totalAlloc);
      await testToken.connect(organizer1).transfer(campaignAddress, totalAlloc);
    });

    it("should set organizer as the campaign owner", async function () {
      expect(await campaign.owner()).to.equal(organizer1.address);
    });

    it("should return accurate campaign summary via getSummary()", async function () {
      const summary = await campaign.getSummary();
      expect(summary.tokenAddress).to.equal(await testToken.getAddress());
      expect(summary.root).to.equal(root);
      expect(summary.totalAlloc).to.equal(totalAlloc);
      expect(summary.recipients).to.equal(recipientCount);
      expect(summary.expiresAt).to.equal(endTime);
      expect(summary.balance).to.equal(totalAlloc);
      expect(summary.isEnded).to.be.false;
    });

    it("should allow eligible claimant to claim allocated tokens", async function () {
      const proof1 = tree.getProof(0);
      const initialContractBal = await testToken.balanceOf(campaignAddress);
      const initialClaimantBal = await testToken.balanceOf(claimant1.address);

      await expect(campaign.connect(claimant1).claim(allocation1, proof1))
        .to.emit(campaign, "Claimed")
        .withArgs(claimant1.address, allocation1);

      expect(await testToken.balanceOf(claimant1.address)).to.equal(initialClaimantBal + allocation1);
      expect(await testToken.balanceOf(campaignAddress)).to.equal(initialContractBal - allocation1);
      expect(await campaign.hasClaimed(claimant1.address)).to.be.true;
    });

    it("should reject duplicate claim from the same wallet", async function () {
      const proof1 = tree.getProof(0);
      await campaign.connect(claimant1).claim(allocation1, proof1);

      await expect(
        campaign.connect(claimant1).claim(allocation1, proof1)
      ).to.be.revertedWithCustomError(campaign, "AlreadyClaimed");
    });

    it("should reject claim with invalid proof", async function () {
      const fakeProof = [ethers.keccak256(ethers.toUtf8Bytes("corrupted"))];
      await expect(
        campaign.connect(claimant1).claim(allocation1, fakeProof)
      ).to.be.revertedWithCustomError(campaign, "InvalidProof");
    });

    it("should reject claim with tampered amount", async function () {
      const proof1 = tree.getProof(0);
      const tamperedAmount = ethers.parseUnits("9999", 18);
      await expect(
        campaign.connect(claimant1).claim(tamperedAmount, proof1)
      ).to.be.revertedWithCustomError(campaign, "InvalidProof");
    });

    it("should reject claim from ineligible wallet not in Merkle tree", async function () {
      const proof1 = tree.getProof(0);
      await expect(
        campaign.connect(ineligibleUser).claim(allocation1, proof1)
      ).to.be.revertedWithCustomError(campaign, "InvalidProof");
    });

    it("should reject claims after campaign end time", async function () {
      const proof1 = tree.getProof(0);

      // Fast-forward time past endTime
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 10]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        campaign.connect(claimant1).claim(allocation1, proof1)
      ).to.be.revertedWithCustomError(campaign, "CampaignEnded");
    });
  });

  describe("Organizer Remaining Token Withdrawal", function () {
    let campaign;
    let campaignAddress;
    let endTime;

    beforeEach(async function () {
      endTime = await getFutureTimestamp(1800); // 30 minutes
      const params = {
        token: await testToken.getAddress(),
        merkleRoot: root,
        name: "Withdrawal Test Campaign",
        description: "Testing token withdrawal mechanics",
        totalAllocation: totalAlloc,
        recipientCount: recipientCount,
        endTime: endTime,
      };

      await factory.connect(organizer1).createCampaign(params);
      campaignAddress = (await factory.getAllCampaigns())[0];

      const CampaignFactory = await ethers.getContractFactory("ClaimiitCampaign");
      campaign = CampaignFactory.attach(campaignAddress);

      // Organizer funds campaign
      await testToken.mint(organizer1.address, totalAlloc);
      await testToken.connect(organizer1).transfer(campaignAddress, totalAlloc);
    });

    it("should reject withdrawal by non-organizer even after campaign ends", async function () {
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 10]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        campaign.connect(claimant1).withdrawRemaining(claimant1.address)
      ).to.be.revertedWithCustomError(campaign, "OwnableUnauthorizedAccount");
    });

    it("should reject withdrawal by organizer while campaign is still active", async function () {
      await expect(
        campaign.connect(organizer1).withdrawRemaining(organizer1.address)
      ).to.be.revertedWithCustomError(campaign, "CampaignStillActive");
    });

    it("should reject withdrawal to zero address", async function () {
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 10]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        campaign.connect(organizer1).withdrawRemaining(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(campaign, "InvalidRecipient");
    });

    it("should allow organizer to withdraw remaining undistributed tokens after campaign ends", async function () {
      // 1. Claimant 1 claims their 100 CDT
      const proof1 = tree.getProof(0);
      await campaign.connect(claimant1).claim(allocation1, proof1);

      // Remaining in contract: 200 CDT
      const remainingTokens = totalAlloc - allocation1;
      expect(await testToken.balanceOf(campaignAddress)).to.equal(remainingTokens);

      // 2. Fast forward past endTime
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 10]);
      await ethers.provider.send("evm_mine", []);

      const initialOrganizerBal = await testToken.balanceOf(organizer1.address);

      // 3. Organizer withdraws remaining
      await expect(campaign.connect(organizer1).withdrawRemaining(organizer1.address))
        .to.emit(campaign, "RemainingWithdrawn")
        .withArgs(organizer1.address, organizer1.address, remainingTokens);

      expect(await testToken.balanceOf(organizer1.address)).to.equal(initialOrganizerBal + remainingTokens);
      expect(await testToken.balanceOf(campaignAddress)).to.equal(0n);
    });

    it("should reject second withdrawal when contract has zero balance", async function () {
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 10]);
      await ethers.provider.send("evm_mine", []);

      await campaign.connect(organizer1).withdrawRemaining(organizer1.address);

      await expect(
        campaign.connect(organizer1).withdrawRemaining(organizer1.address)
      ).to.be.revertedWithCustomError(campaign, "NothingToWithdraw");
    });
  });
});
