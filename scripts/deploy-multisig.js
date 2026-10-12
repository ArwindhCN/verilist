// Hands the admin role of both registries over to a shared multisig wallet (AdminMultisig) with a timelock.
// Run it AFTER `deploy` (and after `seed`, because the old admin loses its power).
//
//   npm run multisig:local     local demo: finishes the whole handover by itself
//   npm run multisig:sepolia   real network: deploys the multisig and OFFERS ownership; the signers accept
//
// Settings (environment variables; only needed on a real network, or to change the local defaults):
//   MULTISIG_OWNERS            comma-separated signer addresses
//   MULTISIG_THRESHOLD         how many signers must approve (default 2)
//   MULTISIG_DELAY_SECONDS     the timelock (default 86400 = 1 day on a real network, 10 seconds locally)
//
// The handover has two steps (see Ownable): the current admin OFFERS ownership, then the multisig ACCEPTS through
// its own approval process. If anything is misconfigured, the offer is simply never accepted and nothing is lost.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DEPLOYMENT_FILE = path.join(__dirname, "..", "frontend", "src", "contracts", "deployment.json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { ethers, network } = hre;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = ["localhost", "hardhat"].includes(network.name) && chainId === 31337;

  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error("frontend/src/contracts/deployment.json not found. Run the deploy script first.");
  }
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  if (deployment.chainId !== chainId) {
    throw new Error(`deployment.json is for chain ${deployment.chainId}, but you are on chain ${chainId}.`);
  }
  const productsAddress = deployment.addresses.ProductRegistry;
  const listingsAddress = deployment.addresses.ListingRegistry;
  if ((await ethers.provider.getCode(productsAddress)) === "0x") {
    throw new Error("No contract at the saved address. Did the node restart? Deploy (and seed) again first.");
  }

  const signers = await ethers.getSigners();
  const currentAdmin = signers[0];
  const products = new ethers.Contract(productsAddress, deployment.abis.ProductRegistry, currentAdmin);
  const listings = new ethers.Contract(listingsAddress, deployment.abis.ListingRegistry, currentAdmin);

  for (const [name, registry] of [["ProductRegistry", products], ["ListingRegistry", listings]]) {
    const owner = await registry.owner();
    if (owner !== currentAdmin.address) {
      throw new Error(
        `${name} is owned by ${owner}, not by the active account ${currentAdmin.address}. ` +
          "Only the current admin can start a handover (it may already have been handed over)."
      );
    }
  }

  // ----- the multisig's settings -----
  let owners = (process.env.MULTISIG_OWNERS || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (owners.length === 0) {
    if (!isLocal) {
      throw new Error("Set MULTISIG_OWNERS to the signers' addresses, for example MULTISIG_OWNERS=0xAAA...,0xBBB...,0xCCC...");
    }
    owners = signers.slice(8, 11).map((s) => s.address); // Hardhat accounts #8, #9, #10 (not used by the demo roles)
  }
  const threshold = Number(process.env.MULTISIG_THRESHOLD || 2);
  const delay = Number(process.env.MULTISIG_DELAY_SECONDS || (isLocal ? 10 : 86400));

  console.log(`Network:   ${network.name} (chain id ${chainId})`);
  console.log(`Admin now: ${currentAdmin.address}`);
  console.log(`Signers:   ${owners.join(", ")}`);
  console.log(`Rule:      ${threshold} of ${owners.length} must approve, then wait ${delay} seconds\n`);

  // ----- step 0: deploy the multisig -----
  const multisig = await (await ethers.getContractFactory("AdminMultisig")).deploy(owners, threshold, delay);
  await multisig.deploymentTransaction().wait();
  const multisigAddress = await multisig.getAddress();
  console.log(`AdminMultisig deployed: ${multisigAddress}`);

  // ----- step 1: the current admin OFFERS ownership (nothing changes yet) -----
  await (await products.transferOwnership(multisigAddress)).wait();
  await (await listings.transferOwnership(multisigAddress)).wait();
  console.log("Step 1 done: the current admin has OFFERED the admin role of both registries to the multisig.");

  const accept = (registry) => registry.interface.encodeFunctionData("acceptOwnership");

  if (!isLocal) {
    console.log("\nStep 2 is for the signers (it needs their own wallets). Each registry must accept through the multisig:");
    console.log(`  1. A signer calls propose(target, data) on ${multisigAddress} twice:`);
    console.log(`       target ${productsAddress}  data ${accept(products)}   (ProductRegistry)`);
    console.log(`       target ${listingsAddress}  data ${accept(listings)}   (ListingRegistry)`);
    console.log(`  2. ${threshold - 1} more signer(s) call approve(id) on each proposal.`);
    console.log(`  3. After ${delay} seconds, anyone calls execute(id) on each proposal.`);
    console.log("Until then the current admin keeps full control, so nothing is lost if this is never finished.");
    return;
  }

  // ----- local demo: play the signers ourselves and finish the handover -----
  const [signer1, signer2] = [signers[8], signers[9]];
  console.log(`\nStep 2 (local demo): signers #8 and #9 accept through the multisig, with the ${delay}s timelock...`);
  const firstId = Number(await multisig.proposalCount()) + 1;
  await (await multisig.connect(signer1).propose(productsAddress, accept(products))).wait();
  await (await multisig.connect(signer1).propose(listingsAddress, accept(listings))).wait();
  await (await multisig.connect(signer2).approve(firstId)).wait();
  await (await multisig.connect(signer2).approve(firstId + 1)).wait();
  console.log("  both proposals approved; waiting for the timelock...");
  await sleep((delay + 2) * 1000);
  await (await multisig.execute(firstId)).wait();
  await (await multisig.execute(firstId + 1)).wait();

  console.log("\nDone.");
  console.log(`  ProductRegistry owner: ${await products.owner()}`);
  console.log(`  ListingRegistry owner: ${await listings.owner()}`);
  console.log("The old admin account can no longer verify brands or register marketplaces.");
  console.log("Open the site's Admin tab to see the multisig notice. Restart the node and re-seed to go back.");
}

main().catch((error) => {
  console.error(`\nHandover failed: ${error.message}`);
  process.exitCode = 1;
});
