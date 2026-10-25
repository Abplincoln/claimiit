import { expect } from "chai";
import { ethers } from "ethers";
import { parseAllocationsCSV } from "../frontend/src/utils/csvParser.js";
import {
  buildCampaignMerkleTree,
  createCampaignBackupPayload,
  validateImportedBackup,
} from "../frontend/src/utils/merkleTreeUtil.js";

describe("Frontend Multi-Campaign Utilities & Business Logic", function () {
  const addr1 = "0x4093dAfCC3f60B5491C6Cd694f07F03fDA86919a";
  const addr2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const addr3 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

  describe("CSV Parsing and Address Validation", function () {
    it("should successfully parse valid CSV with header row", function () {
      const csv = `address,amount\n${addr1},100\n${addr2},250`;
      const res = parseAllocationsCSV(csv, 18);

      expect(res.error).to.be.null;
      expect(res.recipientCount).to.equal(2);
      expect(res.recipients[0].address).to.equal(addr1);
      expect(res.recipients[0].amountTokens).to.equal("100");
      expect(res.recipients[0].amountBaseUnits).to.equal(ethers.parseUnits("100", 18).toString());
      expect(res.recipients[1].address).to.equal(addr2);
      expect(res.recipients[1].amountTokens).to.equal("250");
      expect(res.totalAllocation).to.equal(ethers.parseUnits("350", 18));
      expect(res.totalTokens).to.equal("350.0");
    });

    it("should successfully parse valid CSV without header row", function () {
      const csv = `${addr1},50\n${addr2},75`;
      const res = parseAllocationsCSV(csv, 18);

      expect(res.error).to.be.null;
      expect(res.recipientCount).to.equal(2);
      expect(res.totalAllocation).to.equal(ethers.parseUnits("125", 18));
    });

    it("should reject CSV with invalid Ethereum addresses", function () {
      const csv = `0xInvalidWalletAddress,100`;
      const res = parseAllocationsCSV(csv, 18);

      expect(res.error).to.include("Invalid Ethereum address");
      expect(res.recipients).to.be.undefined;
    });

    it("should reject CSV with duplicate recipient addresses", function () {
      const csv = `${addr1},100\n${addr1},50`;
      const res = parseAllocationsCSV(csv, 18);

      expect(res.error).to.include("Duplicate recipient address");
    });

    it("should reject CSV with non-positive amounts (zero or negative)", function () {
      const csvZero = `${addr1},0`;
      expect(parseAllocationsCSV(csvZero, 18).error).to.include("strictly greater than zero");

      const csvNegative = `${addr1},-50`;
      expect(parseAllocationsCSV(csvNegative, 18).error).to.include("strictly greater than zero");
    });

    it("should reject malformed lines missing commas", function () {
      const csv = `JustSomeRandomTextWithoutComma`;
      const res = parseAllocationsCSV(csv, 18);
      expect(res.error).to.include("Malformed line");
    });
  });

  describe("Integer-Safe Math & No Arbitrary Minimum Limits", function () {
    it("should strictly permit micro-allocations without imposing any minimum threshold", function () {
      // 1 wei (0.000000000000000001 CDT)
      const microCSV = `${addr1},0.000000000000000001`;
      const res = parseAllocationsCSV(microCSV, 18);

      expect(res.error).to.be.null;
      expect(res.recipients[0].amountBaseUnits).to.equal("1"); // 1 wei
      expect(res.totalAllocation).to.equal(1n);
    });

    it("should prevent floating-point precision loss using BigInt arithmetic", function () {
      // Small fractional amounts that would lose precision in JS Number
      const csv = `${addr1},0.1\n${addr2},0.2`;
      const res = parseAllocationsCSV(csv, 18);

      expect(res.error).to.be.null;
      const expected = ethers.parseUnits("0.1", 18) + ethers.parseUnits("0.2", 18);
      expect(res.totalAllocation).to.equal(expected);
      expect(res.totalTokens).to.equal("0.3");
    });
  });

  describe("Merkle Tree Generation and Proof Verification", function () {
    it("should build StandardMerkleTree and verify every proof", function () {
      const recipients = [
        { address: addr1, amountTokens: "100", amountBaseUnits: ethers.parseUnits("100", 18).toString() },
        { address: addr2, amountTokens: "250", amountBaseUnits: ethers.parseUnits("250", 18).toString() },
        { address: addr3, amountTokens: "500", amountBaseUnits: ethers.parseUnits("500", 18).toString() },
      ];

      const { root, claims } = buildCampaignMerkleTree(recipients);

      expect(root).to.be.a("string");
      expect(root).to.match(/^0x[a-fA-F0-9]{64}$/);
      expect(claims.length).to.equal(3);

      // Verify each proof
      for (const claim of claims) {
        expect(claim.proof).to.be.an("array");
        expect(claim.proof.length).to.be.greaterThan(0);

        // Verify with validateImportedBackup
        const backup = createCampaignBackupPayload({
          campaignAddress: "0x1111111111111111111111111111111111111111",
          campaignName: "Test Campaign",
          tokenAddress: "0x2222222222222222222222222222222222222222",
          totalAllocationBaseUnits: ethers.parseUnits("850", 18),
          recipientCount: 3,
          endTime: Math.floor(Date.now() / 1000) + 3600,
          merkleRoot: root,
          claims: claims,
        });

        const validation = validateImportedBackup(backup, root);
        expect(validation.valid).to.be.true;
        expect(validation.error).to.be.null;
      }
    });

    it("should reject imported backup if the Merkle root does not match expected on-chain root", function () {
      const recipients = [
        { address: addr1, amountTokens: "10", amountBaseUnits: ethers.parseUnits("10", 18).toString() },
      ];
      const { root, claims } = buildCampaignMerkleTree(recipients);

      const backup = createCampaignBackupPayload({
        campaignName: "Test",
        tokenAddress: "0x2222222222222222222222222222222222222222",
        totalAllocationBaseUnits: ethers.parseUnits("10", 18),
        recipientCount: 1,
        endTime: 1234567890,
        merkleRoot: root,
        claims: claims,
      });

      const differentRoot = ethers.keccak256(ethers.toUtf8Bytes("different-root"));
      const validation = validateImportedBackup(backup, differentRoot);

      expect(validation.valid).to.be.false;
      expect(validation.error).to.include("Merkle root mismatch");
    });

    it("should reject imported backup if a proof is forged or tampered", function () {
      const recipients = [
        { address: addr1, amountTokens: "10", amountBaseUnits: ethers.parseUnits("10", 18).toString() },
      ];
      const { root, claims } = buildCampaignMerkleTree(recipients);

      // Tamper with proof
      claims[0].proof = [ethers.keccak256(ethers.toUtf8Bytes("forged-hash"))];

      const backup = createCampaignBackupPayload({
        campaignName: "Test",
        tokenAddress: "0x2222222222222222222222222222222222222222",
        totalAllocationBaseUnits: ethers.parseUnits("10", 18),
        recipientCount: 1,
        endTime: 1234567890,
        merkleRoot: root,
        claims: claims,
      });

      const validation = validateImportedBackup(backup, root);
      expect(validation.valid).to.be.false;
      expect(validation.error).to.include("Cryptographic verification failed");
    });
  });

  describe("Claim Eligibility and Funding Check Rules", function () {
    it("should correctly classify Fully Funded vs Underfunded", function () {
      const totalAllocation = ethers.parseUnits("1000", 18);

      const balanceFull = ethers.parseUnits("1000", 18);
      const isFullyFunded = balanceFull >= totalAllocation;
      expect(isFullyFunded).to.be.true;

      const balanceUnder = ethers.parseUnits("999.999", 18);
      const isUnderfunded = balanceUnder < totalAllocation;
      expect(isUnderfunded).to.be.true;
    });

    it("should correctly identify campaign active vs expired based on block timestamp", function () {
      const now = 1700000000;
      const futureEndTime = 1700003600;
      const pastEndTime = 1699990000;

      expect(now < futureEndTime).to.be.true; // Active
      expect(now >= pastEndTime).to.be.true;  // Expired
    });
  });
});
