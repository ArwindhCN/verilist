// Deploys ProductRegistry, then ListingRegistry (which needs the ProductRegistry address).
// Writes frontend/src/contracts/deployment.json so the frontend knows where the contracts are.
//
// Usage:
//   npm run deploy:local     (needs `npm run node` running in another terminal)
//   npm run deploy:sepolia   (needs SEPOLIA_RPC_URL and PRIVATE_KEY in .env)
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const hre = require("hardhat");

const OUTPUT_DIR = path.join(__dirname, "..", "frontend", "src", "contracts");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "deployment.json");

async function main() {
  const { ethers, network, artifacts } = hre;

  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`Network:  ${network.name} (chain id ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  // 1. ProductRegistry has no constructor arguments.
  const productRegistry = await (await ethers.getContractFactory("ProductRegistry")).deploy();
  const productReceipt = await productRegistry.deploymentTransaction().wait();
  const productRegistryAddress = await productRegistry.getAddress();
  console.log(`ProductRegistry deployed: ${productRegistryAddress}`);

  // 2. ListingRegistry needs the address of the ProductRegistry it will read from.
  const listingRegistry = await (await ethers.getContractFactory("ListingRegistry")).deploy(productRegistryAddress);
  await listingRegistry.deploymentTransaction().wait();
  const listingRegistryAddress = await listingRegistry.getAddress();
  console.log(`ListingRegistry deployed: ${listingRegistryAddress}`);

  // The in-process "hardhat" network disappears when this script ends, so a deployment.json for it
  // would point at contracts that no longer exist. Skip the file in that case.
  if (network.name === "hardhat") {
    console.log("\nThis ran on the temporary in-process network, so deployment.json was NOT written.");
    console.log("Start a node with `npm run node`, then run `npm run deploy:local`.");
    return;
  }

  const deployment = {
    chainId,
    network: network.name,
    deployer: deployer.address,
    // The frontend starts reading events from this block, so it never scans the whole chain.
    deploymentBlock: productReceipt.blockNumber,
    deployedAt: new Date().toISOString(),
    addresses: {
      ProductRegistry: productRegistryAddress,
      ListingRegistry: listingRegistryAddress,
    },
    abis: {
      ProductRegistry: (await artifacts.readArtifact("ProductRegistry")).abi,
      ListingRegistry: (await artifacts.readArtifact("ListingRegistry")).abi,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(process.cwd(), OUTPUT_FILE)}`);

  if (network.name === "localhost") {
    console.log("Next step: npm run seed:local");
  } else {
    // On a public network, print the Etherscan pages of the new contracts (one shared source for the links).
    const { explorerUrl } = await import(pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", "explorer.js")).href);
    for (const [name, address] of Object.entries(deployment.addresses)) {
      const link = explorerUrl(chainId, "address", address);
      if (link) console.log(`${name} on Etherscan: ${link}`);
    }
    console.log("Next step: npm run verify:sepolia   (publishes the code on Etherscan; see SEPOLIA_GUIDE.md)");
    console.log(`Done. Deployed at block ${deployment.deploymentBlock}. Start the frontend with: npm run frontend:dev`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
