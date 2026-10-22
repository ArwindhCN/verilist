// Publishes the source code of the deployed contracts on Etherscan ("verification"), so anyone can read the
// code and use the "Read Contract" and "Write Contract" tabs on the Etherscan page.
//
//   npm run verify:sepolia
//
// Run it AFTER `npm run deploy:sepolia`. Needs ETHERSCAN_API_KEY in .env (a free key from etherscan.io).
// To also verify an AdminMultisig, set MULTISIG_ADDRESS plus the same MULTISIG_OWNERS / MULTISIG_THRESHOLD /
// MULTISIG_DELAY_SECONDS that were used when it was deployed.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const hre = require("hardhat");
const { buildTargets, isAlreadyVerified, isNotIndexedYet } = require("./etherscan-helpers.js");

const DEPLOYMENT_FILE = path.join(__dirname, "..", "frontend", "src", "contracts", "deployment.json");
const ATTEMPTS = 5;
const WAIT_MS = 15000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyOne(target) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await hre.run("verify:verify", { address: target.address, constructorArguments: target.constructorArguments });
      return "verified";
    } catch (error) {
      if (isAlreadyVerified(error)) return "already verified";
      if (isNotIndexedYet(error) && attempt < ATTEMPTS) {
        console.log(`    Etherscan has not indexed it yet (attempt ${attempt} of ${ATTEMPTS}). Waiting ${WAIT_MS / 1000}s...`);
        await sleep(WAIT_MS);
        continue;
      }
      throw error;
    }
  }
  return "verified";
}

async function main() {
  const { ethers, network } = hre;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  if (chainId === 31337) {
    throw new Error(
      "Etherscan cannot see a local chain. Deploy to Sepolia first and run this on it:\n" +
        "  npm run deploy:sepolia   then   npm run verify:sepolia\n  (see SEPOLIA_GUIDE.md)"
    );
  }
  if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error(
      "ETHERSCAN_API_KEY is missing. Create a free key at https://etherscan.io/myapikey and add it to your .env file."
    );
  }
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error("frontend/src/contracts/deployment.json not found. Run `npm run deploy:sepolia` first.");
  }
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  if (deployment.chainId !== chainId) {
    throw new Error(`deployment.json is for chain ${deployment.chainId}, but you are connected to chain ${chainId}.`);
  }

  // The explorer addresses live in one place, the frontend's explorer.js, so the website and this script agree.
  const { explorerCodeUrl } = await import(pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", "explorer.js")).href);

  const targets = buildTargets(deployment, process.env);
  console.log(`Network: ${network.name} (chain id ${chainId})\n`);

  let failed = 0;
  for (const target of targets) {
    console.log(`${target.name}  ${target.address}`);
    if ((await ethers.provider.getCode(target.address)) === "0x") {
      console.log("    FAILED: there is no contract at this address on this network.\n");
      failed += 1;
      continue;
    }
    try {
      const result = await verifyOne(target);
      console.log(`    ${result.toUpperCase()}`);
      const link = explorerCodeUrl(chainId, target.address);
      if (link) console.log(`    ${link}`);
    } catch (error) {
      console.log(`    FAILED: ${String(error.message).split("\n")[0]}`);
      failed += 1;
    }
    console.log("");
  }

  if (failed > 0) {
    console.log(`${failed} of ${targets.length} could not be verified. Fix the cause above and run the command again.`);
    process.exitCode = 1;
  } else {
    console.log("All contracts are verified. Open the links above to show the code on Etherscan.");
  }
}

main().catch((error) => {
  console.error(`\nVerification stopped: ${error.message}`);
  process.exitCode = 1;
});
