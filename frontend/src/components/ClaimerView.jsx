import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import legacyProofsData from "../data/proofs.json";
import { validateImportedBackup } from "../utils/merkleTreeUtil.js";
import { CLAIMIIT_CAMPAIGN_ABI, CLAIMIIT_ABI, CLAIMIIT_FACTORY_ABI, ERC20_ABI } from "../contracts/ClaimiitAbi.js";

const LEGACY_CAMPAIGN_ADDRESS = "0xc98B13d6ae131be797Eb62725Dd7c9CD42121dAe";
const DEFAULT_DEMO_TOKEN = "0x7Afa063DE43648d612a61eD40CB0D289f68bD0bA";
const EXPLORER_URL = "https://scan.bohr.life";

export default function ClaimerView({
  account,
  provider,
  isCorrectNetwork,
  factoryAddress,
}) {
  const isFactoryConfigured = Boolean(factoryAddress && ethers.isAddress(factoryAddress));

  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("legacy");
  const [isLoadingList, setIsLoadingList] = useState(false);

  // Selected Campaign Details
  const [activeCampaignData, setActiveCampaignData] = useState(null);
  const [userAllocation, setUserAllocation] = useState(null);
  const [hasClaimedOnChain, setHasClaimedOnChain] = useState(null);

  // Imported backup per campaign
  const [importedBackups, setImportedBackups] = useState({});
  const [importError, setImportError] = useState(null);

  // Claim execution state
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimStatusMessage, setClaimStatusMessage] = useState("");
  const [claimTxHash, setClaimTxHash] = useState(null);

  // Session claim history
  const [claimHistory, setClaimHistory] = useState([]);

  // 1. Discover Campaigns (Legacy Demo + Factory on-chain registry)
  const loadAllCampaigns = useCallback(async () => {
    setIsLoadingList(true);
    const list = [
      {
        id: "legacy",
        address: LEGACY_CAMPAIGN_ADDRESS,
        name: "Stage 4 Verified Demonstration Campaign",
        description: "Official Claimiit proof-of-concept deployment on BOT Chain Bohr Testnet.",
        tokenAddress: DEFAULT_DEMO_TOKEN,
        tokenSymbol: "CDT",
        totalTokens: "850.0",
        recipientCount: 3,
        isLegacy: true,
      },
    ];

    if (provider && isFactoryConfigured) {
      try {
        const factory = new ethers.Contract(factoryAddress, CLAIMIIT_FACTORY_ABI, provider);
        const addresses = await factory.getAllCampaigns();

        for (const addr of addresses) {
          try {
            const campaignContract = new ethers.Contract(addr, CLAIMIIT_CAMPAIGN_ABI, provider);
            const [summary, name, desc] = await Promise.all([
              campaignContract.getSummary(),
              campaignContract.name().catch(() => "Campaign"),
              campaignContract.description().catch(() => ""),
            ]);

            list.push({
              id: addr.toLowerCase(),
              address: addr,
              name,
              description: desc,
              tokenAddress: summary.tokenAddress,
              tokenSymbol: "CDT",
              totalTokens: ethers.formatUnits(summary.totalAlloc, 18),
              totalAllocBaseUnits: summary.totalAlloc,
              recipientCount: Number(summary.recipients),
              expiresAt: Number(summary.expiresAt),
              balance: summary.balance,
              balanceTokens: ethers.formatUnits(summary.balance, 18),
              isEnded: summary.isEnded,
              merkleRoot: summary.root,
              isLegacy: false,
            });
          } catch (err) {
            console.error(`Error loading campaign ${addr}:`, err);
          }
        }
      } catch (err) {
        console.error("Error loading factory campaigns:", err);
      }
    }

    setCampaigns(list);
    setIsLoadingList(false);
  }, [provider, isFactoryConfigured, factoryAddress]);

  useEffect(() => {
    loadAllCampaigns();
  }, [loadAllCampaigns]);

  // 2. Load Selected Campaign State & Determine User Eligibility
  const refreshSelectedCampaign = useCallback(async () => {
    if (!selectedCampaignId || campaigns.length === 0) return;
    const selected = campaigns.find((c) => c.id === selectedCampaignId) || campaigns[0];

    let summaryData = { ...selected };
    let onChainClaimed = false;

    if (provider && ethers.isAddress(selected.address)) {
      try {
        if (selected.isLegacy) {
          const legacyContract = new ethers.Contract(selected.address, CLAIMIIT_ABI, provider);
          const tokenContract = new ethers.Contract(selected.tokenAddress, ERC20_ABI, provider);
          const claimsList = legacyProofsData?.claims || [];
          const claimChecks = claimsList.map((c) =>
            legacyContract.hasClaimed(c.address).catch(() => false)
          );
          const [claimed, bal, ...claimsStatus] = await Promise.all([
            account ? legacyContract.hasClaimed(account) : false,
            tokenContract.balanceOf(selected.address).catch(() => 0n),
            ...claimChecks,
          ]);

          let remainingUnclaimedBaseUnits = 0n;
          claimsList.forEach((c, idx) => {
            if (!claimsStatus[idx]) {
              remainingUnclaimedBaseUnits += BigInt(c.amountBaseUnits);
            }
          });

          onChainClaimed = claimed;
          summaryData.balance = bal;
          summaryData.balanceTokens = ethers.formatUnits(bal, 18);
          summaryData.isFullyFunded = bal >= remainingUnclaimedBaseUnits;
        } else {
          const campaignContract = new ethers.Contract(selected.address, CLAIMIIT_CAMPAIGN_ABI, provider);
          const summary = await campaignContract.getSummary();
          onChainClaimed = account ? await campaignContract.hasClaimed(account) : false;
          summaryData.balanceTokens = ethers.formatUnits(summary.balance, 18);
          summaryData.balance = summary.balance;
          summaryData.isEnded = summary.isEnded;
          summaryData.isFullyFunded = summary.balance >= summary.totalAlloc;
          summaryData.merkleRoot = summary.root;
        }
      } catch (err) {
        console.error("Error refreshing campaign state:", err);
      }
    }

    setActiveCampaignData(summaryData);
    setHasClaimedOnChain(onChainClaimed);

    // Resolve Proof & Allocation for Connected Wallet
    if (!account) {
      setUserAllocation(null);
      return;
    }

    let claimProofItem = null;

    if (selected.isLegacy) {
      // Use bundled legacy demonstration proofs
      claimProofItem = legacyProofsData.claims.find(
        (c) => c.address.toLowerCase() === account.toLowerCase()
      );
    } else {
      // Check imported backup or localStorage for custom campaign
      const stored =
        importedBackups[selected.address.toLowerCase()] ||
        (() => {
          try {
            const raw = localStorage.getItem(`claimiit_backup_${selected.address.toLowerCase()}`);
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        })();

      if (stored && stored.claims) {
        claimProofItem = stored.claims.find(
          (c) => c.address.toLowerCase() === account.toLowerCase()
        );
      }
    }

    setUserAllocation(claimProofItem || null);
  }, [selectedCampaignId, campaigns, provider, account, importedBackups]);

  useEffect(() => {
    refreshSelectedCampaign();
  }, [refreshSelectedCampaign]);

  // 3. Handle Backup JSON Import for Custom Campaign
  const handleFileUpload = (e) => {
    setImportError(null);
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const result = validateImportedBackup(event.target.result, activeCampaignData?.merkleRoot);
        if (!result.valid) {
          setImportError(result.error);
          return;
        }

        const backup = result.backup;
        const campKey = (backup.campaignAddress || activeCampaignData?.address || "").toLowerCase();

        setImportedBackups((prev) => ({
          ...prev,
          [campKey]: backup,
        }));

        alert("Campaign backup imported and verified successfully against on-chain root!");
        refreshSelectedCampaign();
      } catch (err) {
        setImportError(`Failed to process backup file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // 4. Submit Claim Transaction
  const handleClaim = async () => {
    if (!account || !isCorrectNetwork || !activeCampaignData || !userAllocation || !provider) return;

    setIsClaiming(true);
    setClaimStatusMessage("Please confirm the claim transaction in MetaMask...");
    setClaimTxHash(null);

    try {
      const signer = await provider.getSigner();
      let tx;

      if (activeCampaignData.isLegacy) {
        const legacyContract = new ethers.Contract(activeCampaignData.address, CLAIMIIT_ABI, signer);
        tx = await legacyContract.claim(userAllocation.amountBaseUnits, userAllocation.proof);
      } else {
        const campaignContract = new ethers.Contract(activeCampaignData.address, CLAIMIIT_CAMPAIGN_ABI, signer);
        tx = await campaignContract.claim(userAllocation.amountBaseUnits, userAllocation.proof);
      }

      setClaimTxHash(tx.hash);
      setClaimStatusMessage(`Transaction broadcast! Waiting for confirmation on BOT Chain Bohr Testnet...`);

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        setClaimStatusMessage(`Successfully claimed ${userAllocation.amountTokens} CDT!`);
        setHasClaimedOnChain(true);

        // Record in session claim history
        setClaimHistory((prev) => [
          {
            campaignName: activeCampaignData.name,
            campaignAddress: activeCampaignData.address,
            amountTokens: userAllocation.amountTokens,
            txHash: tx.hash,
            timestamp: new Date().toLocaleTimeString(),
          },
          ...prev,
        ]);

        refreshSelectedCampaign();
      } else {
        setClaimStatusMessage("Claim transaction reverted on-chain.");
      }
    } catch (err) {
      console.error("Claim error:", err);
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setClaimStatusMessage("Transaction was cancelled by user.");
      } else if (err.message && err.message.includes("AlreadyClaimed")) {
        setClaimStatusMessage("This allocation has already been claimed.");
        setHasClaimedOnChain(true);
      } else if (err.message && err.message.includes("CampaignEnded")) {
        setClaimStatusMessage("This campaign has ended. Claims are closed.");
      } else {
        setClaimStatusMessage(`Claim failed: ${err.reason || err.shortMessage || err.message}`);
      }
    } finally {
      setIsClaiming(false);
    }
  };

  const cannotCoverAllocation = Boolean(
    userAllocation &&
    activeCampaignData?.balance !== undefined &&
    BigInt(activeCampaignData.balance) < BigInt(userAllocation.amountBaseUnits)
  );

  return (
    <div className="claimer-view">
      {/* Campaign Catalog Selector */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h2>Available Distribution Campaigns</h2>
          <button className="btn btn-neutral-sm" onClick={loadAllCampaigns} disabled={isLoadingList}>
            {isLoadingList ? "Loading..." : "↻ Refresh"}
          </button>
        </div>

        {!isFactoryConfigured && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "12px" }}>
            Note: Multi-campaign factory discovery is pending Stage 4 factory deployment.
            The verified <strong>Stage 4 Demonstration Campaign</strong> is loaded and ready for claiming below!
          </p>
        )}

        <div className="campaign-tabs-list">
          {campaigns.map((camp) => (
            <button
              key={camp.id}
              className={`campaign-tab-btn ${selectedCampaignId === camp.id ? "active" : ""}`}
              onClick={() => setSelectedCampaignId(camp.id)}
            >
              <div style={{ fontWeight: 600 }}>{camp.name}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {camp.totalTokens} CDT • {camp.recipientCount} recipients {camp.isLegacy ? "(Live Demo)" : ""}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Selected Campaign Claim Box */}
      {activeCampaignData && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h2>{activeCampaignData.name}</h2>
            <span className={`badge ${activeCampaignData.isEnded ? "badge-danger" : activeCampaignData.isFullyFunded ? "badge-success" : "badge-warning"}`}>
              {activeCampaignData.isEnded ? "Campaign Ended" : activeCampaignData.isFullyFunded ? "Fully Funded" : "Underfunded"}
            </span>
          </div>

          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "16px" }}>
            {activeCampaignData.description}
          </p>

          {/* Campaign Metrics */}
          <div className="row">
            <span className="row-label">Campaign Address</span>
            <span className="row-value">
              <a href={`${EXPLORER_URL}/address/${activeCampaignData.address}`} target="_blank" rel="noopener noreferrer" className="tx-hash-link">
                {activeCampaignData.address.slice(0, 8)}...{activeCampaignData.address.slice(-6)}
              </a>
            </span>
          </div>

          <div className="row">
            <span className="row-label">Contract Token Balance</span>
            <span className="row-value">
              <strong>{activeCampaignData.balanceTokens || "0"} CDT</strong> (Total Allocated: {activeCampaignData.totalTokens} CDT)
            </span>
          </div>

          {activeCampaignData.expiresAt && (
            <div className="row">
              <span className="row-label">Campaign Deadline</span>
              <span className="row-value">{new Date(activeCampaignData.expiresAt * 1000).toLocaleString()}</span>
            </div>
          )}

          {/* Connected User Eligibility Section */}
          <div className="row" style={{ marginTop: "12px", borderTop: "1px solid var(--border-color)", paddingTop: "12px" }}>
            <span className="row-label">Your Wallet Allocation</span>
            <span className="row-value">
              {!account ? (
                <span className="badge badge-neutral">Connect Wallet First</span>
              ) : userAllocation ? (
                <strong style={{ color: "#3fb950" }}>{userAllocation.amountTokens} CDT</strong>
              ) : (
                <span className="badge badge-danger">No Allocation for this Wallet</span>
              )}
            </span>
          </div>

          <div className="row">
            <span className="row-label">Your Claim Status</span>
            <span className="row-value">
              {!account ? (
                <span className="badge badge-neutral">—</span>
              ) : hasClaimedOnChain === true ? (
                <span className="badge badge-success">Already Claimed</span>
              ) : userAllocation ? (
                <span className="badge badge-warning">Ready to Claim</span>
              ) : (
                <span className="badge badge-danger">Not Eligible</span>
              )}
            </span>
          </div>

          {/* Custom Campaign Proof Restoration Box */}
          {!activeCampaignData.isLegacy && !userAllocation && (
            <div className="import-box" style={{ marginTop: "16px", padding: "14px", background: "#0d1117", borderRadius: "8px", border: "1px dashed var(--border-color)" }}>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "8px" }}>
                Eligibility data not found in browser storage for this campaign. If the organizer shared a campaign backup JSON file, import it below:
              </p>
              <input type="file" accept=".json" onChange={handleFileUpload} className="input-field" style={{ fontSize: "0.85rem" }} />
              {importError && (
                <div className="alert alert-danger" style={{ marginTop: "8px", fontSize: "0.8rem" }}>
                  {importError}
                </div>
              )}
            </div>
          )}

          {/* Status Message */}
          {claimStatusMessage && (
            <div className={`alert ${hasClaimedOnChain ? "alert-success" : "alert-info"}`} style={{ marginTop: "16px" }}>
              {claimStatusMessage}
              {claimTxHash && (
                <div style={{ marginTop: "6px" }}>
                  Tx:{" "}
                  <a href={`${EXPLORER_URL}/tx/${claimTxHash}`} target="_blank" rel="noopener noreferrer" className="tx-hash-link">
                    {claimTxHash}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Claim Action Button */}
          {account && (
            <button
              className="btn btn-primary"
              style={{ marginTop: "20px" }}
              onClick={handleClaim}
              disabled={
                !isCorrectNetwork ||
                !userAllocation ||
                hasClaimedOnChain === true ||
                isClaiming ||
                activeCampaignData.isEnded ||
                cannotCoverAllocation
              }
            >
              {isClaiming
                ? "Processing Claim..."
                : hasClaimedOnChain
                ? "Allocation Already Claimed"
                : !userAllocation
                ? "Wallet Not Eligible for this Campaign"
                : activeCampaignData.isEnded
                ? "Campaign Has Ended"
                : cannotCoverAllocation
                ? "Insufficient Campaign Balance"
                : `Claim ${userAllocation.amountTokens} CDT (No Minimum)`}
            </button>
          )}
        </section>
      )}

      {/* Claim History Section */}
      <section className="card">
        <h3>My Claim History</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "12px" }}>
          Confirmed on-chain claims executed in your current session.
        </p>

        {claimHistory.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No claims recorded in this session yet.
          </p>
        ) : (
          <div className="claim-history-list">
            {claimHistory.map((item, idx) => (
              <div key={idx} className="sample-item">
                <div>
                  <strong>{item.campaignName}</strong>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Claimed {item.amountTokens} CDT • {item.timestamp}
                  </div>
                </div>
                <a href={`${EXPLORER_URL}/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer" className="tx-hash-link" style={{ fontSize: "0.8rem" }}>
                  View on Explorer ↗
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
