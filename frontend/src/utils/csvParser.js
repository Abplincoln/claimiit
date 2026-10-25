import { ethers } from "ethers";

/**
 * Validates and parses CSV text containing address and amount columns.
 * Supports "address,amount" format with or without header.
 * 
 * Critical Rules:
 * - NO minimum allocation amount: any positive amount (> 0) is valid.
 * - Integer-safe BigInt calculations for base units.
 * - Duplicate recipient detection.
 * 
 * @param {string} csvText - Raw CSV content
 * @param {number} decimals - Token decimals (e.g. 18)
 * @returns {{ recipients: Array, totalAllocation: bigint, totalTokens: string, recipientCount: number, error: string|null }}
 */
export function parseAllocationsCSV(csvText, decimals = 18) {
  if (!csvText || !csvText.trim()) {
    return { error: "CSV content is empty." };
  }

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { error: "CSV contains no data rows." };
  }

  const recipients = [];
  const seenAddresses = new Set();
  let totalAllocation = 0n;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Split by comma or semicolon
    const parts = line.split(/[,;\t]/).map((p) => p.trim());

    if (parts.length < 2) {
      return { error: `Line ${i + 1}: Malformed line. Expected "address,amount".` };
    }

    const [rawAddress, rawAmount] = parts;

    // Check if line 1 is a header row
    if (i === 0) {
      const lowerAddr = rawAddress.toLowerCase();
      const lowerAmt = rawAmount.toLowerCase();
      if (
        (lowerAddr.includes("address") || lowerAddr.includes("wallet") || lowerAddr.includes("account")) &&
        (lowerAmt.includes("amount") || lowerAmt.includes("allocation") || lowerAmt.includes("token"))
      ) {
        continue; // Skip header
      }
    }

    // Validate EVM Address
    if (!ethers.isAddress(rawAddress)) {
      return { error: `Line ${i + 1}: Invalid Ethereum address "${rawAddress}".` };
    }
    const checksumAddress = ethers.getAddress(rawAddress);

    // Duplicate Check
    const lower = checksumAddress.toLowerCase();
    if (seenAddresses.has(lower)) {
      return { error: `Line ${i + 1}: Duplicate recipient address "${checksumAddress}". Each wallet must appear only once.` };
    }
    seenAddresses.add(lower);

    // Validate and Convert Amount (Integer-safe via ethers.parseUnits)
    if (!rawAmount || isNaN(Number(rawAmount))) {
      return { error: `Line ${i + 1}: Invalid amount "${rawAmount}". Must be a valid positive number.` };
    }

    let baseUnits;
    try {
      baseUnits = ethers.parseUnits(rawAmount, decimals);
    } catch (err) {
      return { error: `Line ${i + 1}: Failed to convert amount "${rawAmount}" with ${decimals} decimals (${err.message}).` };
    }

    // Must be strictly positive (> 0n). No arbitrary minimum threshold!
    if (baseUnits <= 0n) {
      return { error: `Line ${i + 1}: Amount must be strictly greater than zero.` };
    }

    totalAllocation += baseUnits;

    recipients.push({
      address: checksumAddress,
      amountTokens: rawAmount,
      amountBaseUnits: baseUnits.toString(),
    });
  }

  if (recipients.length === 0) {
    return { error: "No valid recipient rows found in CSV." };
  }

  return {
    recipients,
    totalAllocation,
    totalTokens: ethers.formatUnits(totalAllocation, decimals),
    recipientCount: recipients.length,
    error: null,
  };
}
