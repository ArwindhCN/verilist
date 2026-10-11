// Fills a LOCAL chain with demo data so the frontend has something to show.
// Run after `npm run node` and `npm run deploy:local`:   npm run seed:local
//
// Uses Hardhat's default accounts:
//   #0 Admin   #1 Fastrack (brand)   #2 Titan (brand)   #3 Flipkart (marketplace)   #4 Amazon (marketplace)
//   #5 RetailNet (seller)   #6 QuickShop (seller)   #7 FakeDeals (unauthorized seller)
// All brands, marketplaces and products below are made-up demo data.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const CONTRACTS_DIR = path.join(__dirname, "..", "frontend", "src", "contracts");
const DEPLOYMENT_FILE = path.join(CONTRACTS_DIR, "deployment.json");
const DEMO_ACCOUNTS_FILE = path.join(CONTRACTS_DIR, "demo-accounts.json");

// Role name -> Hardhat account index. The frontend account switcher is built from this.
const ROLES = [
  { name: "Admin", index: 0, role: "admin" },
  { name: "Fastrack", index: 1, role: "brand" },
  { name: "Titan", index: 2, role: "brand" },
  { name: "Flipkart", index: 3, role: "marketplace" },
  { name: "Amazon", index: 4, role: "marketplace" },
  { name: "RetailNet", index: 5, role: "seller" },
  { name: "QuickShop", index: 6, role: "seller" },
  { name: "FakeDeals", index: 7, role: "unauthorized seller" },
];

const PRODUCTS = {
  reflexPro: {
    brand: "fastrack",
    sku: "FT-REFLEX-PRO",
    name: "Fastrack Reflex Pro",
    details: {
      model: "Reflex Pro",
      category: "Smartwatch",
      specs: { battery: "7 days", display: "1.83 inch HD", "water resistance": "IP68" },
      mrp: 2995,
      warranty: "1 year",
    },
  },
  chromaAnalog: {
    brand: "fastrack",
    sku: "FT-CHROMA-AN",
    name: "Fastrack Chroma Analog",
    details: {
      model: "Chroma Analog",
      category: "Analog watch",
      specs: { case: "Polycarbonate", strap: "Silicone", "water resistance": "50 m" },
      mrp: 1495,
      warranty: "2 years",
    },
    // Used by step 5 of the seed: a second version so version history exists.
    updatedDetails: {
      model: "Chroma Analog",
      category: "Analog watch",
      specs: { case: "Polycarbonate", strap: "Silicone", "water resistance": "100 m" },
      mrp: 1695,
      warranty: "2 years",
    },
  },
  edgeSlim: {
    brand: "titan",
    sku: "TT-EDGE-SLIM",
    name: "Titan Edge Slim",
    details: {
      model: "Edge Slim",
      category: "Analog watch",
      specs: { case: "Stainless steel", thickness: "3.5 mm", glass: "Sapphire" },
      mrp: 15995,
      warranty: "2 years",
    },
  },
};

async function main() {
  const { ethers, network } = hre;

  // Guard: seed data must never be written to a real network.
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = ["localhost", "hardhat"].includes(network.name) && chainId === 31337;
  if (!isLocal) {
    throw new Error(
      `seed.js only runs on a local network (localhost / hardhat, chain id 31337). ` +
        `You are on "${network.name}" (chain id ${chainId}). Refusing to seed.`
    );
  }

  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error("frontend/src/contracts/deployment.json not found. Run `npm run deploy:local` first.");
  }
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  if (deployment.chainId !== chainId) {
    throw new Error(`deployment.json is for chain ${deployment.chainId} but you are on chain ${chainId}. Redeploy.`);
  }

  const { ProductRegistry: productsAddress, ListingRegistry: listingsAddress } = deployment.addresses;
  if ((await ethers.provider.getCode(productsAddress)) === "0x") {
    throw new Error(
      "No contract found at the address in deployment.json. Did the node restart? " +
        "Run `npm run deploy:local` again, then `npm run seed:local`."
    );
  }

  const signers = await ethers.getSigners();
  const who = Object.fromEntries(ROLES.map((r) => [r.name.toLowerCase(), signers[r.index]]));
  const products = new ethers.Contract(productsAddress, deployment.abis.ProductRegistry, signers[0]);
  const listings = new ethers.Contract(listingsAddress, deployment.abis.ListingRegistry, signers[0]);

  // Seeding twice would just fail on "already verified", so check first and explain.
  if ((await products.getBrand(who.fastrack.address)).verified) {
    throw new Error(
      "This deployment is already seeded. To start fresh: stop the node, run `npm run node` again, " +
        "then `npm run deploy:local && npm run seed:local`."
    );
  }

  // Sends a transaction and waits for it to be mined, so the next step sees its result.
  const send = async (txPromise) => (await txPromise).wait();

  console.log("1/6  Verifying brands and registering marketplaces...");
  await send(products.connect(who.admin).verifyBrand(who.fastrack.address, "Fastrack"));
  await send(products.connect(who.admin).verifyBrand(who.titan.address, "Titan"));
  await send(listings.connect(who.admin).registerMarketplace(who.flipkart.address, "Flipkart"));
  await send(listings.connect(who.admin).registerMarketplace(who.amazon.address, "Amazon"));

  console.log("2/6  Registering 3 products...");
  const ids = {};
  for (const [key, p] of Object.entries(PRODUCTS)) {
    const brandSigner = who[p.brand];
    ids[key] = await products.computeProductId(brandSigner.address, p.sku);
    await send(products.connect(brandSigner).registerProduct(p.sku, p.name, JSON.stringify(p.details)));
  }

  console.log("3/6  Authorizing sellers...");
  const authorize = (key, seller) =>
    send(products.connect(who[PRODUCTS[key].brand]).authorizeSeller(ids[key], who[seller].address));
  await authorize("reflexPro", "retailnet");
  await authorize("chromaAnalog", "quickshop");
  await authorize("edgeSlim", "retailnet"); // no listing yet: Flipkart can list it live in the demo

  console.log("4/6  Creating 3 genuine listings...");
  const list = (marketplace, key, seller, ref) =>
    send(listings.connect(who[marketplace]).createListing(ids[key], who[seller].address, ref));
  await list("flipkart", "reflexPro", "retailnet", "FLIP-883021"); // listing #1
  await list("amazon", "reflexPro", "retailnet", "AMZ-B0DEMO001"); // listing #2
  await list("amazon", "chromaAnalog", "quickshop", "AMZ-B0DEMO002"); // listing #3

  console.log("5/6  Updating one product once so version history exists...");
  // Chroma Analog is updated; Reflex Pro stays at version 1 so the live demo can update it.
  await send(
    products
      .connect(who.fastrack)
      .updateProductDetails(ids.chromaAnalog, JSON.stringify(PRODUCTS.chromaAnalog.updatedDetails))
  );

  console.log("6/6  Writing demo-accounts.json...");
  const demoAccounts = {};
  for (const r of ROLES) {
    demoAccounts[r.name] = { address: signers[r.index].address, index: r.index, role: r.role };
  }
  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  fs.writeFileSync(DEMO_ACCOUNTS_FILE, JSON.stringify(demoAccounts, null, 2) + "\n");

  // Summary table
  const statusNames = [
    "GENUINE",
    "LISTING_NOT_FOUND",
    "LISTING_REMOVED",
    "MARKETPLACE_INACTIVE",
    "PRODUCT_NOT_FOUND",
    "BRAND_NOT_VERIFIED",
    "PRODUCT_INACTIVE",
    "SELLER_NOT_AUTHORIZED",
    "DUPLICATE_LISTING",
  ];
  const nameOf = (address) => ROLES.find((r) => signers[r.index].address === address)?.name ?? address;
  const rows = [];
  const count = Number(await listings.getListingCount());
  for (let id = 1; id <= count; id++) {
    const listing = await listings.getListing(id);
    const product = await products.getProduct(listing.productId);
    rows.push({
      "Listing #": id,
      Marketplace: nameOf(listing.marketplace),
      Product: product.name,
      Seller: nameOf(listing.seller),
      Ref: listing.externalRef,
      Version: Number(await products.getVersionCount(listing.productId)),
      Status: statusNames[Number(await listings.verifyListing(id))],
    });
  }

  console.log("\nSeed complete. Accounts:");
  console.table(ROLES.map((r) => ({ Role: `${r.name} (${r.role})`, Account: `#${r.index}`, Address: signers[r.index].address })));
  console.log("Listings:");
  console.table(rows);
  console.log("Next step: npm run frontend:dev");
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exitCode = 1;
});
