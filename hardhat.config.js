import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey && deployerKey.trim() !== ""
  ? [deployerKey.trim().startsWith("0x") ? deployerKey.trim() : `0x${deployerKey.trim()}`]
  : [];

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {},
    bohrTestnet: {
      url: "https://rpc.bohr.life",
      chainId: 968,
      accounts: accounts,
    },
  },
};
