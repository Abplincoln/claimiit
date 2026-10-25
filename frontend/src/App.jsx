import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import RoleSelector from "./components/RoleSelector.jsx";
import ClaimerView from "./components/ClaimerView.jsx";
import OrganizerView from "./components/OrganizerView.jsx";

const TARGET_CHAIN_ID_DEC = 968;
const TARGET_CHAIN_ID_HEX = "0x3c8";
const RPC_URL = "https://rpc.bohr.life";
const EXPLORER_URL = "https://scan.bohr.life";
const OFFICIAL_WEBSITE_URL = "https://www.botchain.ai";

export default function App() {
  const [account, setAccount] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [provider, setProvider] = useState(null);

  // Role state: "claimer" | "organizer" (persisted in localStorage)
  const [activeRole, setActiveRole] = useState(() => {
    try {
      return localStorage.getItem("claimiit_active_role") || "claimer";
    } catch {
      return "claimer";
    }
  });

  const factoryAddress =
    import.meta.env.VITE_CLAIMIIT_FACTORY_ADDRESS ||
    "0x942c6E7DEd92D0C7fd11502619e312EddE7CecB1";

  const handleSelectRole = (role) => {
    setActiveRole(role);
    try {
      localStorage.setItem("claimiit_active_role", role);
    } catch {
      // ignore storage error
    }
  };

  // Sync state whenever account or chain changes
  const updateWalletState = useCallback(async (acc, chainIdVal) => {
    setAccount(acc);
    setCurrentChainId(chainIdVal);

    const isValidChain = Number(chainIdVal) === TARGET_CHAIN_ID_DEC;
    setIsCorrectNetwork(isValidChain);

    if (typeof window.ethereum !== "undefined") {
      setProvider(new ethers.BrowserProvider(window.ethereum));
    }
  }, []);

  // Listen to EIP-1193 wallet events
  useEffect(() => {
    if (typeof window.ethereum === "undefined") return;

    setProvider(new ethers.BrowserProvider(window.ethereum));

    const handleAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        updateWalletState(accounts[0], currentChainId);
      } else {
        updateWalletState(null, currentChainId);
      }
    };

    const handleChainChanged = (chainIdHex) => {
      const decChainId = parseInt(chainIdHex, 16);
      updateWalletState(account, decChainId);
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    // Initial check
    window.ethereum
      .request({ method: "eth_accounts" })
      .then(async (accounts) => {
        if (accounts.length > 0) {
          const chainHex = await window.ethereum.request({ method: "eth_chainId" });
          updateWalletState(accounts[0], parseInt(chainHex, 16));
        }
      })
      .catch((err) => console.error("Error reading accounts:", err));

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
        window.ethereum.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, [account, currentChainId, updateWalletState]);

  // Connect Wallet Action
  const connectWallet = async () => {
    if (typeof window.ethereum === "undefined") {
      alert("No Web3 wallet detected. Please install MetaMask to use Claimiit.");
      return;
    }

    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const chainHex = await window.ethereum.request({ method: "eth_chainId" });
      updateWalletState(accounts[0], parseInt(chainHex, 16));
    } catch (err) {
      console.error("Wallet connection failed:", err);
      alert(`Connection failed: ${err.message || "User rejected"}`);
    }
  };

  // Switch Network to BOT Chain Bohr Testnet
  const switchNetwork = async () => {
    if (typeof window.ethereum === "undefined") return;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: TARGET_CHAIN_ID_HEX,
                chainName: "BOT Chain Bohr Testnet",
                nativeCurrency: { name: "BOHR", symbol: "BOHR", decimals: 18 },
                rpcUrls: [RPC_URL],
                blockExplorerUrls: [EXPLORER_URL],
              },
            ],
          });
        } catch (addError) {
          console.error("Failed to add BOT Chain network:", addError);
        }
      } else {
        console.error("Failed to switch network:", switchError);
      }
    }
  };

  return (
    <div className="app-wrapper">
      {/* Top Header */}
      <header className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <span className="brand-badge">BOT Chain Bohr Testnet</span>
          <div className="wallet-header-controls">
            {!account ? (
              <button className="btn btn-primary-sm" onClick={connectWallet}>
                Connect MetaMask
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={`badge ${isCorrectNetwork ? "badge-success" : "badge-danger"}`}>
                  {isCorrectNetwork ? "Bohr (968)" : "Wrong Network"}
                </span>
                <span className="badge badge-neutral" title={account}>
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </div>
            )}
          </div>
        </div>

        <h1>Claimiit</h1>
        <p>Decentralized Merkle-Proof Token Distribution on BOT Chain</p>
      </header>

      {/* Network Switch Banner */}
      {account && !isCorrectNetwork && (
        <div className="alert alert-warning" style={{ marginBottom: "20px" }}>
          You are connected to an unsupported network (Chain ID: {currentChainId || "Unknown"}). Please switch to BOT Chain Bohr Testnet (Chain ID: 968).
          <button className="btn btn-warning" onClick={switchNetwork} style={{ marginTop: "10px" }}>
            Switch to BOT Chain Bohr Testnet
          </button>
        </div>
      )}

      {/* Role Selector Tabs */}
      <RoleSelector activeRole={activeRole} onSelectRole={handleSelectRole} />

      {/* Main View Container */}
      <main style={{ marginTop: "16px" }}>
        {activeRole === "claimer" ? (
          <ClaimerView
            account={account}
            provider={provider}
            isCorrectNetwork={isCorrectNetwork}
            factoryAddress={factoryAddress}
          />
        ) : (
          <OrganizerView
            account={account}
            provider={provider}
            isCorrectNetwork={isCorrectNetwork}
            factoryAddress={factoryAddress}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>Claimiit Platform • Built on BOT Chain Bohr Testnet</p>
        <div className="footer-links">
          <a
            href={OFFICIAL_WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            Official BOT Chain Website
          </a>
          <span>•</span>
          <a
            href={EXPLORER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            BOT Chain Bohr Testnet Explorer
          </a>
        </div>
      </footer>
    </div>
  );
}
