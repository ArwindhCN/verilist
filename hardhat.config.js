// Hardhat configuration for VeriList.
// Local work needs no .env file. The Sepolia network is only added when both
// SEPOLIA_RPC_URL and PRIVATE_KEY exist, so a missing .env never breaks local commands.
// Etherscan verification additionally needs ETHERSCAN_API_KEY.
require("dotenv").config({ quiet: true });
require("@nomicfoundation/hardhat-toolbox");

const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // `npm run node` starts a local chain on this address; chain id 31337 is Hardhat's default.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  gasReporter: {
    // Only print the gas table when asked (REPORT_GAS=true), to keep normal test output short.
    enabled: process.env.REPORT_GAS === "true",
  },
};

// Etherscan verification (npm run verify:sepolia). One free key works for every network on Etherscan.
// Sourcify is switched off so the command prints only what matters.
if (ETHERSCAN_API_KEY) {
  config.etherscan = { apiKey: ETHERSCAN_API_KEY };
}
config.sourcify = { enabled: false };

if (SEPOLIA_RPC_URL && PRIVATE_KEY) {
  config.networks.sepolia = {
    url: SEPOLIA_RPC_URL,
    accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
    chainId: 11155111,
  };
}

module.exports = config;
