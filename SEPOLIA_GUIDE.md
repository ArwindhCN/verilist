# Sepolia, MetaMask and Etherscan: step-by-step guide

This guide moves VeriList from your laptop's local chain to the **Sepolia public test network**, so you can show:

- a **real wallet** (MetaMask) signing real transactions,
- **test coins** (Sepolia ETH) paying the network fee for each transaction,
- your **contract code published on Etherscan**, with every transaction viewable there.

> **Safety rules (read first)**
> - Use a **test-only** MetaMask account. **Never** use an account that holds real money.
> - Sepolia ETH has **no value**. Never pay for it.
> - Your private key goes **only** in the `.env` file on your own computer. `.env` is git-ignored. **Never** paste it in chat, in a document, or on GitHub.
> - Never share your MetaMask **recovery phrase** with anyone.

> **Honest note:** this guide was written and its tooling tested on a local simulation (Etherscan's reply was simulated). The first run on the real Sepolia and Etherscan may need small adjustments. If a step looks different on your screen (websites change their wording), search for the new name, or ask for help.

---

## Part 1: One-time accounts (about 20 minutes)

### 1. MetaMask
1. Install MetaMask from **metamask.io** (browser extension) and create a wallet. Save the recovery phrase privately.
2. Open the network menu at the top and turn on **Show test networks** (in *Settings → Advanced* in some versions). Choose **Sepolia**.
3. Create **four accounts** (account menu → *Add account*) and rename them:

| MetaMask account | Role in VeriList |
|---|---|
| `VeriList Admin` | Deploys the contracts, so it becomes the **Admin** |
| `Fastrack` | A **brand** |
| `Flipkart` | A **marketplace** |
| `RetailNet` | A **seller** |

You can reduce this to fewer accounts, but then one account plays several roles and the demo is less clear.

### 2. Free test ETH (a "faucet")
1. Search for **"Sepolia faucet"**. Examples: the Alchemy Sepolia faucet, the Google Cloud Web3 faucet, the Infura faucet. Some need a free account.
2. Request test ETH to the **`VeriList Admin`** address (click the account name in MetaMask to copy it).
3. Send a little to the other three accounts from MetaMask (for example **0.01 ETH** each).

**How much do you need?** I measured the real gas use of each action on the contracts:

| Action | Gas | Cost at 1 gwei |
|---|---|---|
| Deploy `ProductRegistry` + `ListingRegistry` | about 4.0 million | about **0.004 ETH** (about 0.04 ETH on a busy network) |
| Admin: verify a brand / register a marketplace | about 117,000 | about 0.0001 ETH |
| Brand: register a product | about 347,000 | about 0.0003 ETH |
| Brand: authorize a seller | about 120,000 | about 0.0001 ETH |
| Marketplace: create a listing | about 316,000 | about 0.0003 ETH |
| Brand: update details | about 197,000 | about 0.0002 ETH |
| Brand: revoke a seller | about 31,000 | about 0.00003 ETH |

So about **0.05 ETH for the Admin** and **0.01 ETH for each other account** is plenty. (Cost = gas × the gas price at that moment. Sepolia is usually very cheap.)

### 3. An RPC URL (how your computer talks to Sepolia)
1. Create a free account at **alchemy.com** or **infura.io**.
2. Create an app or project on **Ethereum Sepolia**.
3. Copy the **HTTPS** URL (it contains your API key, so treat it as private).

### 4. An Etherscan API key (to publish your code)
1. Create a free account at **etherscan.io**.
2. Open *API Keys* in your profile, click **Add**, and copy the key. One key works for all networks.

### 5. The deployer's private key
1. In MetaMask, select **`VeriList Admin`**, open *Account details*, click **Show private key**, and enter your password.
2. Copy it. You will paste it into `.env` in Part 2. **Do not share it anywhere else.**

---

## Part 2: Fill in `.env`

In the project folder:

```bash
cp .env.example .env
```

On Windows PowerShell: `Copy-Item .env.example .env`. Then open `.env` and fill in:

```
SEPOLIA_RPC_URL=https://...your Alchemy or Infura Sepolia URL...
PRIVATE_KEY=0x...the VeriList Admin test account's private key...
ETHERSCAN_API_KEY=...your Etherscan key...
```

---

## Part 3: Deploy to Sepolia

```bash
npm run deploy:sepolia
```

Expected output (addresses will differ):

```
Network:  sepolia (chain id 11155111)
ProductRegistry deployed: 0x...
ListingRegistry deployed: 0x...
ProductRegistry on Etherscan: https://sepolia.etherscan.io/address/0x...
ListingRegistry on Etherscan: https://sepolia.etherscan.io/address/0x...
Next step: npm run verify:sepolia
```

The deploying wallet (`VeriList Admin`) is now the platform **Admin**. This also rewrites `frontend/src/contracts/deployment.json` for Sepolia.

---

## Part 4: Publish the code on Etherscan ("verify")

Wait about 30 seconds after the deploy, then:

```bash
npm run verify:sepolia
```

Expected output:

```
ProductRegistry  0x...
    VERIFIED
    https://sepolia.etherscan.io/address/0x...#code
ListingRegistry  0x...
    VERIFIED
    https://sepolia.etherscan.io/address/0x...#code
All contracts are verified.
```

Open a link. On the **Contract** tab you will see a green tick, the full Solidity source code, and the **Read Contract** and **Write Contract** tabs. If it says "Unable to locate ContractCode", the script waits and retries by itself (up to 5 times, 15 seconds apart).

---

## Part 5: Use the website with MetaMask

```bash
npm run frontend:dev
```

Open <http://localhost:5173>. Because the deployment is on Sepolia, the site opens in **MetaMask mode** automatically. The header shows `sepolia · chain 11155111` and links to your contracts on Etherscan.

1. Click **Connect wallet** and approve in MetaMask. If MetaMask is on another network, click **Switch network in wallet**.
2. Switching the account in MetaMask changes who you are on the site (shown next to "Wallet").

### The story with real accounts
Every action opens a MetaMask pop-up. Click **Confirm**. On Sepolia a transaction takes about 12 seconds to confirm (slower than your local chain).

| # | Account in MetaMask | Where | What to do |
|---|---|---|---|
| 1 | `VeriList Admin` | **Admin** tab | *Brand wallet* → **Other address…** → paste the `Fastrack` address, name `Fastrack` → **Verify brand** |
| 2 | `VeriList Admin` | **Admin** tab | *Marketplace wallet* → **Other address…** → paste the `Flipkart` address, name `Flipkart` → **Register marketplace** |
| 3 | `Fastrack` | **Brand** tab | **Register a product** (SKU `FT-REFLEX-PRO`, name, details) |
| 4 | `Fastrack` | **Brand** tab, the product card | *Authorize a seller* → **Other address…** → paste the `RetailNet` address → **Authorize seller** |
| 5 | `Flipkart` | **Marketplace** tab | Choose the product, seller **Other address…** = the `RetailNet` address, a reference such as `FLIP-1` → **Create listing** |
| 6 | anyone | **Verify** tab | Click **#1**: **Genuine listing** |
| 7 | `Fastrack` | **Brand** tab | **Revoke** RetailNet → **Verify #1** turns **Not genuine** → authorize again → genuine |

After each transaction the site shows *Confirmed in block N* with a **clickable transaction link to Etherscan**. The Activity panel does the same for every event.

---

## Part 6: What to show your teacher on Etherscan

1. **The verified contract:** your `#code` link. Point to the green tick and the source code. Say: "Anyone can read and check our contract code."
2. **A transaction:** click a transaction link, for example *register product* or *revoke seller*. Point to:
   - **Status: Success**,
   - **From** (the Brand account) and **To** (our contract),
   - **Transaction Fee**: this is the **real Sepolia ETH paid**, the "coin" part,
   - the **Logs** tab: the events our contract emitted (for example `ProductRegistered`, `SellerRevoked`). This is the same data the Activity panel shows.
3. **Read Contract:** the contract page → *Read Contract* → for example `getListing` or `verifyListing` with `1`. This is the same live check the website uses.
4. **MetaMask:** the *Activity* list, plus a confirmation pop-up (with the gas fee) during a live action.

---

## Part 7: If something goes wrong

| Problem | Fix |
|---|---|
| `HH100: Network sepolia doesn't exist` | `.env` is missing `SEPOLIA_RPC_URL` or `PRIVATE_KEY`. Both are needed. |
| `insufficient funds` | The account has no Sepolia ETH. Use a faucet. |
| `ETHERSCAN_API_KEY is missing` | Add the key to `.env` and run the command again. |
| Verify says **Invalid API Key** | Copy the key again from etherscan.io (no spaces) and update `.env`. |
| Verify says "already verified" | That is fine. It counts as success. |
| Verify says **constructor arguments mismatch** | Run `npm run verify:sepolia` from the same project folder you deployed from. The script passes the ProductRegistry address to ListingRegistry for you. |
| Website says **wrong network** | Click **Switch network in wallet**, or choose Sepolia in MetaMask. |
| Website says **The contracts are no longer on this chain** | `deployment.json` points to another network. Run `npm run deploy:sepolia` again, or restore the file by running the local deploy. |
| Transaction stays pending | Wait up to a minute. Check the transaction on Etherscan. In MetaMask you can **Speed up**. |
| MetaMask shows a **nonce** error | MetaMask → Settings → Advanced → **Clear activity tab data** (it only clears local history). |
| The Activity panel says **Reconnecting…** | The network connection (RPC) is busy or hit a limit. Wait a moment. In MetaMask you can edit the Sepolia network and use your own Alchemy or Infura URL from Part 1. |
| You clicked **Reject** in MetaMask | Normal. The site shows "You rejected the request in your wallet. Nothing was sent." |

## Going back to the local demo
Run `npm run deploy:local` (with `npm run node` running). It overwrites `deployment.json`. Your `.env` and Sepolia contracts are not affected.

## Optional: a shared multisig admin on Sepolia
After deploying, `npm run multisig:sepolia` deploys an `AdminMultisig` and only **offers** the admin role to it. See the "Safer admin" section of the README. To verify the multisig on Etherscan as well, set `MULTISIG_ADDRESS` (plus the same `MULTISIG_OWNERS`, `MULTISIG_THRESHOLD` and `MULTISIG_DELAY_SECONDS`) in `.env` before running `npm run verify:sepolia`.

## What is not included (next update)
The contracts deliberately **never hold or send money** (they are not `payable`). The only coins involved are the **network fees** (gas) paid for each transaction. A real payment feature, for example a listing fee or an escrow, would be a new design decision for a later update.
