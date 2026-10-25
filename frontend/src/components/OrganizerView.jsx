import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { parseAllocationsCSV } from "../utils/csvParser.js";
import { buildCampaignMerkleTree, createCampaignBackupPayload } from "../utils/merkleTreeUtil.js";
import { CLAIMIIT_FACTORY_ABI, CLAIMIIT_CAMPAIGN_ABI, ERC20_ABI } from "../contracts/ClaimiitAbi.js";

const DEFAULT_DEMO_TOKEN = "0x7Afa063DE43648d612a61eD40CB0D289f68bD0bA";
const EXPLORER_URL = "https://scan.bohr.life";

export default function OrganizerView({
  account,
  provider,
  isCorrectNetwork,
  factoryAddress,
}) {
  const isFactoryConfigured = Boolean(factoryAddress && ethers.isAddress(factoryAddress));

  // Form states
  const [campaignName, setCampaignName] = useState("");
  const [description, setDescription] = useState("");
  const [tokenAddress, setTokenAddress] = useState(DEFAULT_DEMO_TOKEN);
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenSymbol, setTokenSymbol] = useState("CDT");
  const [endTimeLocal, setEndTimeLocal] = useState("");
  const [inputMode, setInputMode] = useState("csv"); // "csv" | "manual"

  // Allocation data
  const [csvText, setCsvText] = useState("");
  const [manualRows, setManualRows] = useState([{ address: "", amount: "" }]);
  const [parsedRecipients, setParsedRecipients] = useState([]);
  const [totalAllocBaseUnits, setTotalAllocBaseUnits] = useState(0n);
  const [totalTokensDisplay, setTotalTokensDisplay] = useState("0");
  const [validationError, setValidationError] = useState(null);

  // Status & loading
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txMessage, setTxMessage] = useState("");
  const [createdCampaignResult, setCreatedCampaignResult] = useState(null);

  // Existing campaigns managed by organizer
  const [organizerCampaigns, setOrganizerCampaigns] = useState([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);

  // Funding modal / inline state
  const [fundingAmount, setFundingAmount] = useState({});
  const [fundingStatus, setFundingStatus] = useState({});

  // 1. Fetch Token Metadata when tokenAddress changes
  useEffect(() => {
    async function fetchTokenInfo() {
      if (!provider || !ethers.isAddress(tokenAddress)) return;
      try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const [sym, dec] = await Promise.all([
          tokenContract.symbol().catch(() => "TOK"),
          tokenContract.decimals().catch(() => 18),
        ]);
        setTokenSymbol(sym);
        setTokenDecimals(Number(dec));
      } catch {
        setTokenSymbol("CDT");
        setTokenDecimals(18);
      }
    }
    fetchTokenInfo();
  }, [provider, tokenAddress]);

  // 2. Parse Recipients dynamically on changes
  useEffect(() => {
    setValidationError(null);
    if (inputMode === "csv") {
      if (!csvText.trim()) {
        setParsedRecipients([]);
        setTotalAllocBaseUnits(0n);
        setTotalTokensDisplay("0");
        return;
      }
      const res = parseAllocationsCSV(csvText, tokenDecimals);
      if (res.error) {
        setValidationError(res.error);
        setParsedRecipients([]);
        setTotalAllocBaseUnits(0n);
        setTotalTokensDisplay("0");
      } else {
        setParsedRecipients(res.recipients);
        setTotalAllocBaseUnits(res.totalAllocation);
        setTotalTokensDisplay(res.totalTokens);
      }
    } else {
      // Manual rows
      const validRows = manualRows.filter((r) => r.address.trim() || r.amount.trim());
      if (validRows.length === 0) {
        setParsedRecipients([]);
        setTotalAllocBaseUnits(0n);
        setTotalTokensDisplay("0");
        return;
      }
      const manualCSV = validRows.map((r) => `${r.address.trim()},${r.amount.trim()}`).join("\n");
      const res = parseAllocationsCSV(manualCSV, tokenDecimals);
      if (res.error) {
        setValidationError(res.error);
        setParsedRecipients([]);
        setTotalAllocBaseUnits(0n);
        setTotalTokensDisplay("0");
      } else {
        setParsedRecipients(res.recipients);
        setTotalAllocBaseUnits(res.totalAllocation);
        setTotalTokensDisplay(res.totalTokens);
      }
    }
  }, [csvText, manualRows, inputMode, tokenDecimals]);

  // 3. Load Organizer's Deployed Campaigns
  const loadOrganizerCampaigns = useCallback(async () => {
    if (!provider || !isFactoryConfigured || !account) {
      setOrganizerCampaigns([]);
      return;
    }

    setIsLoadingCampaigns(true);
    try {
      const factory = new ethers.Contract(factoryAddress, CLAIMIIT_FACTORY_ABI, provider);
      const campaignAddresses = await factory.getOrganizerCampaigns(account);

      const loaded = [];
      for (const addr of campaignAddresses) {
        try {
          const campaignContract = new ethers.Contract(addr, CLAIMIIT_CAMPAIGN_ABI, provider);
          const [summary, name, desc] = await Promise.all([
            campaignContract.getSummary(),
            campaignContract.name().catch(() => "Unnamed"),
            campaignContract.description().catch(() => ""),
          ]);

          loaded.push({
            address: addr,
            name,
            description: desc,
            token: summary.tokenAddress,
            root: summary.root,
            totalAllocation: summary.totalAlloc,
            totalTokens: ethers.formatUnits(summary.totalAlloc, tokenDecimals),
            recipientCount: Number(summary.recipients),
            expiresAt: Number(summary.expiresAt),
            balance: summary.balance,
            balanceTokens: ethers.formatUnits(summary.balance, tokenDecimals),
            isEnded: summary.isEnded,
            isFullyFunded: summary.balance >= summary.totalAlloc,
          });
        } catch (err) {
          console.error(`Failed to load campaign ${addr}:`, err);
        }
      }
      setOrganizerCampaigns(loaded);
    } catch (err) {
      console.error("Failed to load organizer campaigns:", err);
    } finally {
      setIsLoadingCampaigns(false);
    }
  }, [provider, isFactoryConfigured, account, tokenDecimals, factoryAddress]);

  useEffect(() => {
    loadOrganizerCampaigns();
  }, [loadOrganizerCampaigns]);

  // Handle Manual Row operations
  const handleAddManualRow = () => {
    setManualRows([...manualRows, { address: "", amount: "" }]);
  };

  const handleUpdateManualRow = (index, field, value) => {
    const updated = [...manualRows];
    updated[index][field] = value;
    setManualRows(updated);
  };

  const handleRemoveManualRow = (index) => {
    setManualRows(manualRows.filter((_, i) => i !== index));
  };

  // 4. Create Campaign
  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    if (!account || !isCorrectNetwork) return;

    if (!campaignName.trim()) {
      alert("Please provide a campaign name.");
      return;
    }
    if (!ethers.isAddress(tokenAddress)) {
      alert("Please provide a valid ERC-20 token address.");
      return;
    }
    if (!endTimeLocal) {
      alert("Please select a campaign end date and time.");
      return;
    }

    const endTimestamp = Math.floor(new Date(endTimeLocal).getTime() / 1000);
    const nowTimestamp = Math.floor(Date.now() / 1000);
    if (endTimestamp <= nowTimestamp) {
      alert("Campaign end time must be in the future.");
      return;
    }

    if (parsedRecipients.length === 0 || validationError) {
      alert("Please provide at least one valid recipient allocation without errors.");
      return;
    }

    setIsSubmitting(true);
    setTxMessage("Building Merkle tree and generating recipient proofs...");
    setCreatedCampaignResult(null);

    try {
      // Build Merkle Tree client-side
      const { root, claims } = buildCampaignMerkleTree(parsedRecipients);

      const backupPayload = createCampaignBackupPayload({
        campaignName: campaignName.trim(),
        campaignDescription: description.trim(),
        tokenAddress: ethers.getAddress(tokenAddress),
        tokenSymbol,
        tokenDecimals,
        totalAllocationBaseUnits: totalAllocBaseUnits,
        recipientCount: parsedRecipients.length,
        endTime: endTimestamp,
        merkleRoot: root,
        claims,
      });

      if (!isFactoryConfigured) {
        // Factory not deployed yet: Download backup and inform user
        const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `claimiit-draft-${campaignName.replace(/\s+/g, "_")}.json`;
        a.click();

        setCreatedCampaignResult({
          mode: "draft",
          merkleRoot: root,
          totalTokens: totalTokensDisplay,
          recipientCount: parsedRecipients.length,
          backupPayload,
        });
        setTxMessage("Draft campaign created and backup JSON downloaded. (Factory deployment pending).");
        setIsSubmitting(false);
        return;
      }

      // If factory is configured, deploy on-chain
      setTxMessage("Please approve campaign creation in your wallet...");
      const signer = await provider.getSigner();
      const factory = new ethers.Contract(factoryAddress, CLAIMIIT_FACTORY_ABI, signer);

      const params = {
        token: ethers.getAddress(tokenAddress),
        merkleRoot: root,
        name: campaignName.trim(),
        description: description.trim(),
        totalAllocation: totalAllocBaseUnits,
        recipientCount: BigInt(parsedRecipients.length),
        endTime: BigInt(endTimestamp),
      };

      const tx = await factory.createCampaign(params);
      setTxMessage(`Transaction submitted (${tx.hash}). Waiting for confirmation on Bohr Testnet...`);

      const receipt = await tx.wait();
      let newCampaignAddress = "";

      // Extract campaign address from CampaignCreated event
      for (const log of receipt.logs) {
        try {
          const parsedLog = factory.interface.parseLog(log);
          if (parsedLog && parsedLog.name === "CampaignCreated") {
            newCampaignAddress = parsedLog.args.campaignAddress;
            break;
          }
        } catch {
          // ignore non-matching logs
        }
      }

      backupPayload.campaignAddress = newCampaignAddress;

      // Store in localStorage for organizer convenience
      try {
        localStorage.setItem(`claimiit_backup_${newCampaignAddress.toLowerCase()}`, JSON.stringify(backupPayload));
      } catch {
        // ignore storage errors
      }

      // Trigger automatic backup download
      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `claimiit-campaign-${newCampaignAddress.slice(0, 8)}.json`;
      a.click();

      setCreatedCampaignResult({
        mode: "live",
        address: newCampaignAddress,
        txHash: tx.hash,
        merkleRoot: root,
        totalTokens: totalTokensDisplay,
        backupPayload,
      });

      setTxMessage("Campaign successfully created on BOT Chain Bohr Testnet! Backup JSON downloaded.");
      loadOrganizerCampaigns();
    } catch (err) {
      console.error("Campaign creation error:", err);
      setTxMessage(`Failed: ${err.reason || err.shortMessage || err.message || "Unknown error"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. Transfer Tokens to Campaign (Direct ERC-20 transfer)
  const handleFundCampaign = async (campaignAddr, requiredTokens) => {
    if (!account || !isCorrectNetwork || !provider) return;
    const amountToTransfer = fundingAmount[campaignAddr] || requiredTokens;

    setFundingStatus((prev) => ({ ...prev, [campaignAddr]: "Submitting transfer..." }));

    try {
      const signer = await provider.getSigner();
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const baseUnits = ethers.parseUnits(amountToTransfer.toString(), tokenDecimals);

      const tx = await tokenContract.transfer(campaignAddr, baseUnits);
      setFundingStatus((prev) => ({ ...prev, [campaignAddr]: `Transfer pending: ${tx.hash.slice(0, 10)}...` }));
      await tx.wait();

      setFundingStatus((prev) => ({ ...prev, [campaignAddr]: "Tokens transferred successfully!" }));
      loadOrganizerCampaigns();
    } catch (err) {
      console.error("Funding error:", err);
      setFundingStatus((prev) => ({
        ...prev,
        [campaignAddr]: `Error: ${err.reason || err.shortMessage || err.message}`,
      }));
    }
  };

  // 6. Withdraw Remaining Tokens (Post-expiry only)
  const handleWithdrawRemaining = async (campaignAddr) => {
    if (!account || !isCorrectNetwork || !provider) return;

    try {
      const signer = await provider.getSigner();
      const campaignContract = new ethers.Contract(campaignAddr, CLAIMIIT_CAMPAIGN_ABI, signer);

      const tx = await campaignContract.withdrawRemaining(account);
      alert(`Withdrawal transaction submitted: ${tx.hash}`);
      await tx.wait();
      alert("Remaining tokens withdrawn successfully to your wallet.");
      loadOrganizerCampaigns();
    } catch (err) {
      console.error("Withdrawal error:", err);
      alert(`Withdrawal failed: ${err.reason || err.shortMessage || err.message}`);
    }
  };

  return (
    <div className="organizer-view">
      {/* Factory Configuration Banner */}
      {!isFactoryConfigured && (
        <div className="alert alert-info" style={{ marginBottom: "20px" }}>
          <strong>Multi-Campaign Factory Notice:</strong>
          <p style={{ marginTop: "4px" }}>
            The <code>ClaimiitFactory</code> contract address is not configured yet (pending Stage 4 multi-campaign deployment).
            You can still draft campaigns, test CSV validation, generate cryptographic Merkle trees, and download JSON backups below.
          </p>
        </div>
      )}

      {/* Organizer's Existing Campaigns List */}
      {isFactoryConfigured && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2>My Deployed Campaigns</h2>
            <button className="btn btn-neutral-sm" onClick={loadOrganizerCampaigns} disabled={isLoadingCampaigns}>
              {isLoadingCampaigns ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>

          {organizerCampaigns.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              You have not created any campaigns yet with this wallet. Use the form below to launch your first token distribution!
            </p>
          ) : (
            <div className="campaign-list">
              {organizerCampaigns.map((camp) => (
                <div key={camp.address} className="campaign-item-card">
                  <div className="campaign-item-header">
                    <h3>{camp.name}</h3>
                    <span className={`badge ${camp.isEnded ? "badge-danger" : camp.isFullyFunded ? "badge-success" : "badge-warning"}`}>
                      {camp.isEnded ? "Campaign Ended" : camp.isFullyFunded ? "Fully Funded" : "Underfunded"}
                    </span>
                  </div>
                  {camp.description && <p className="campaign-item-desc">{camp.description}</p>}

                  <div className="campaign-item-grid">
                    <div>
                      <span className="row-label">Contract Address:</span>
                      <a href={`${EXPLORER_URL}/address/${camp.address}`} target="_blank" rel="noopener noreferrer" className="tx-hash-link">
                        {camp.address.slice(0, 6)}...{camp.address.slice(-4)}
                      </a>
                    </div>
                    <div>
                      <span className="row-label">Balance:</span>
                      <strong>{camp.balanceTokens} / {camp.totalTokens} CDT</strong>
                    </div>
                    <div>
                      <span className="row-label">Recipients:</span>
                      <span>{camp.recipientCount} wallets</span>
                    </div>
                    <div>
                      <span className="row-label">Expires:</span>
                      <span>{new Date(camp.expiresAt * 1000).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Funding Actions */}
                  {!camp.isFullyFunded && !camp.isEnded && (
                    <div className="funding-box" style={{ marginTop: "12px", padding: "12px", background: "#0d1117", borderRadius: "8px" }}>
                      <p style={{ fontSize: "0.85rem", color: "#e3b341", marginBottom: "8px" }}>
                        ⚠️ <strong>Funding Required:</strong> Transfer tokens to activate claims.
                      </p>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Amount in CDT"
                          defaultValue={camp.totalTokens}
                          onChange={(e) => setFundingAmount({ ...fundingAmount, [camp.address]: e.target.value })}
                          style={{ maxWidth: "160px" }}
                        />
                        <button
                          className="btn btn-warning"
                          style={{ marginTop: "0", padding: "8px 16px", fontSize: "0.85rem" }}
                          onClick={() => handleFundCampaign(camp.address, camp.totalTokens)}
                        >
                          Transfer CDT to Campaign
                        </button>
                      </div>
                      {fundingStatus[camp.address] && (
                        <p style={{ fontSize: "0.8rem", marginTop: "6px", color: "var(--text-muted)" }}>
                          {fundingStatus[camp.address]}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Post-Expiry Withdrawal */}
                  {camp.isEnded && (
                    <div style={{ marginTop: "12px" }}>
                      <button
                        className="btn btn-warning"
                        style={{ marginTop: "0", fontSize: "0.85rem", padding: "8px 16px" }}
                        onClick={() => handleWithdrawRemaining(camp.address)}
                      >
                        Withdraw Remaining Tokens (No Minimum)
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Create Campaign Section */}
      <section className="card">
        <h2>Create Token Distribution Campaign</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "20px" }}>
          Distribute ERC-20 demonstration tokens to multiple recipient wallets using a single, immutable Merkle root.
        </p>

        <form onSubmit={handleCreateCampaign}>
          {/* Campaign Name */}
          <div className="form-group">
            <label className="form-label">Campaign Name *</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. BOT Chain Community Drop"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="input-field"
              rows="2"
              placeholder="e.g. Demonstration allocation for early testnet supporters"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Token Address & Expiry */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div className="form-group">
              <label className="form-label">ERC-20 Token Address *</label>
              <input
                type="text"
                className="input-field"
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
                required
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Symbol: {tokenSymbol} ({tokenDecimals} decimals)
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Campaign End Date & Time *</label>
              <input
                type="datetime-local"
                className="input-field"
                value={endTimeLocal}
                onChange={(e) => setEndTimeLocal(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Recipient Allocations Input Mode */}
          <div className="form-group" style={{ marginTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label className="form-label" style={{ marginBottom: "0" }}>Recipient Allocations *</label>
              <div className="toggle-group">
                <button
                  type="button"
                  className={`toggle-btn ${inputMode === "csv" ? "active" : ""}`}
                  onClick={() => setInputMode("csv")}
                >
                  CSV Format
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${inputMode === "manual" ? "active" : ""}`}
                  onClick={() => setInputMode("manual")}
                >
                  Manual Rows
                </button>
              </div>
            </div>

            {inputMode === "csv" ? (
              <div>
                <textarea
                  className="input-field"
                  rows="5"
                  placeholder="0x4093dAfCC3f60B5491C6Cd694f07F03fDA86919a,100&#10;0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,250&#10;0x90F79bf6EB2c4f870365E785982E1f101E93b906,500"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  <span>Format: <code>address,amount</code> (no header required).</span>
                  <span>No minimum allocation amount (micro-allocations permitted).</span>
                </div>
              </div>
            ) : (
              <div>
                {manualRows.map((row, idx) => (
                  <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="0x... Recipient Address"
                      value={row.address}
                      onChange={(e) => handleUpdateManualRow(idx, "address", e.target.value)}
                      style={{ flex: 3 }}
                    />
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Amount"
                      value={row.amount}
                      onChange={(e) => handleUpdateManualRow(idx, "amount", e.target.value)}
                      style={{ flex: 1 }}
                    />
                    {manualRows.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-neutral-sm"
                        onClick={() => handleRemoveManualRow(idx)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn btn-neutral-sm" onClick={handleAddManualRow}>
                  + Add Recipient
                </button>
              </div>
            )}

            {/* Validation Error Banner */}
            {validationError && (
              <div className="alert alert-danger" style={{ marginTop: "10px" }}>
                {validationError}
              </div>
            )}

            {/* Total Calculation Display */}
            {parsedRecipients.length > 0 && !validationError && (
              <div className="summary-box" style={{ marginTop: "12px", padding: "12px", background: "#0d1117", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Valid Recipients:</span>
                  <strong>{parsedRecipients.length} unique wallets</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                  <span>Total Funding Required:</span>
                  <strong style={{ color: "#58a6ff" }}>{totalTokensDisplay} {tokenSymbol}</strong>
                </div>
              </div>
            )}
          </div>

          {/* Action Message */}
          {txMessage && (
            <div className="alert alert-info" style={{ marginTop: "16px" }}>
              {txMessage}
            </div>
          )}

          {/* Created Result Panel */}
          {createdCampaignResult && (
            <div className="alert alert-success" style={{ marginTop: "16px" }}>
              <strong>Campaign Created:</strong>
              {createdCampaignResult.mode === "live" ? (
                <div style={{ marginTop: "6px" }}>
                  Address:{" "}
                  <a href={`${EXPLORER_URL}/address/${createdCampaignResult.address}`} target="_blank" rel="noopener noreferrer" className="tx-hash-link">
                    {createdCampaignResult.address}
                  </a>
                  <p style={{ marginTop: "4px", fontSize: "0.85rem" }}>
                    Next step: Transfer <strong>{createdCampaignResult.totalTokens} CDT</strong> to the campaign address above to activate claiming for your recipients.
                  </p>
                </div>
              ) : (
                <div style={{ marginTop: "6px" }}>
                  <p>Merkle Root: <code>{createdCampaignResult.merkleRoot}</code></p>
                  <p>A backup file was downloaded to your machine with all precomputed proofs.</p>
                </div>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: "20px" }}
            disabled={isSubmitting || parsedRecipients.length === 0 || Boolean(validationError)}
          >
            {isSubmitting
              ? "Deploying Campaign..."
              : isFactoryConfigured
              ? `Deploy Campaign (${totalTokensDisplay} ${tokenSymbol})`
              : `Generate Merkle Tree & Download Backup`}
          </button>
        </form>
      </section>
    </div>
  );
}
