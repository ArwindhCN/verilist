// Tests for AdminMultisig: a shared admin with a timelock, used as the owner of the two registries.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const DELAY = 3600; // one hour
const MAX_DELAY = 30 * 24 * 60 * 60;

/** Registries owned by `admin`, plus a 2-of-3 multisig (signers s1, s2, s3) with a one-hour timelock. */
async function worldFixture() {
  const [admin, s1, s2, s3, outsider, brand, marketplace] = await ethers.getSigners();
  const products = await (await ethers.getContractFactory("ProductRegistry")).deploy();
  const listings = await (await ethers.getContractFactory("ListingRegistry")).deploy(await products.getAddress());
  const multisig = await (await ethers.getContractFactory("AdminMultisig")).deploy(
    [s1.address, s2.address, s3.address],
    2,
    DELAY
  );
  return { admin, s1, s2, s3, outsider, brand, marketplace, products, listings, multisig };
}

/** Encodes "call `fn` on `contract` with `args`", the form a multisig proposal needs. */
const encode = (contract, fn, args = []) => contract.interface.encodeFunctionData(fn, args);

/** Runs one proposal all the way: s1 proposes, s2 approves, wait out the delay, anyone executes. */
async function runProposal(w, target, data) {
  const id = await w.multisig.connect(w.s1).propose.staticCall(target, data);
  await w.multisig.connect(w.s1).propose(target, data);
  await w.multisig.connect(w.s2).approve(id);
  await time.increase(DELAY);
  await w.multisig.connect(w.outsider).execute(id);
  return id;
}

/** Hands ownership of a registry to the multisig: the admin offers, the multisig accepts through a proposal. */
async function handOver(w, registry) {
  await registry.connect(w.admin).transferOwnership(await w.multisig.getAddress());
  await runProposal(w, await registry.getAddress(), encode(registry, "acceptOwnership"));
}

describe("AdminMultisig", function () {
  describe("Constructor", function () {
    it("stores the signers, the threshold and the delay", async function () {
      const { multisig, s1, s2, s3, outsider } = await loadFixture(worldFixture);
      expect(await multisig.getOwners()).to.deep.equal([s1.address, s2.address, s3.address]);
      expect(await multisig.threshold()).to.equal(2n);
      expect(await multisig.delay()).to.equal(BigInt(DELAY));
      expect(await multisig.isOwner(s1.address)).to.equal(true);
      expect(await multisig.isOwner(outsider.address)).to.equal(false);
      expect(await multisig.proposalCount()).to.equal(0n);
    });

    it("rejects an invalid setup, each with its own error", async function () {
      const { s1, s2, s3 } = await loadFixture(worldFixture);
      const factory = await ethers.getContractFactory("AdminMultisig");
      const three = [s1.address, s2.address, s3.address];

      await expect(factory.deploy([], 1, 0)).to.be.revertedWithCustomError(factory, "NoOwners");

      const eleven = Array.from({ length: 11 }, () => ethers.Wallet.createRandom().address);
      await expect(factory.deploy(eleven, 2, 0))
        .to.be.revertedWithCustomError(factory, "TooManyOwners")
        .withArgs(11, 10);

      await expect(factory.deploy([s1.address, ethers.ZeroAddress], 1, 0)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress"
      );
      await expect(factory.deploy([s1.address, s2.address, s1.address], 2, 0))
        .to.be.revertedWithCustomError(factory, "DuplicateOwner")
        .withArgs(s1.address);

      await expect(factory.deploy(three, 0, 0)).to.be.revertedWithCustomError(factory, "InvalidThreshold").withArgs(0, 3);
      await expect(factory.deploy(three, 4, 0)).to.be.revertedWithCustomError(factory, "InvalidThreshold").withArgs(4, 3);

      await expect(factory.deploy(three, 2, MAX_DELAY + 1))
        .to.be.revertedWithCustomError(factory, "DelayTooLong")
        .withArgs(MAX_DELAY + 1, MAX_DELAY);
    });

    it("accepts the extreme valid values: 10 signers, threshold = signers, delay = 30 days, delay = 0", async function () {
      const factory = await ethers.getContractFactory("AdminMultisig");
      const ten = Array.from({ length: 10 }, () => ethers.Wallet.createRandom().address);
      await expect(factory.deploy(ten, 10, MAX_DELAY)).to.not.be.reverted;
      await expect(factory.deploy([ten[0]], 1, 0)).to.not.be.reverted;
    });
  });

  describe("propose", function () {
    it("lets a signer propose; the proposer's approval counts at once", async function () {
      const w = await loadFixture(worldFixture);
      const data = encode(w.products, "verifyBrand", [w.brand.address, "Fastrack"]);
      const target = await w.products.getAddress();

      await expect(w.multisig.connect(w.s1).propose(target, data))
        .to.emit(w.multisig, "ProposalCreated")
        .withArgs(1, w.s1.address, target, data)
        .and.to.emit(w.multisig, "ProposalApproved")
        .withArgs(1, w.s1.address, 1);

      expect(await w.multisig.proposalCount()).to.equal(1n);
      expect(await w.multisig.hasApproved(1, w.s1.address)).to.equal(true);
      const proposal = await w.multisig.getProposal(1);
      expect(proposal.proposer).to.equal(w.s1.address);
      expect(proposal.target).to.equal(target);
      expect(proposal.data).to.equal(data);
      expect(proposal.approvals).to.equal(1n);
      expect(proposal.executableAt).to.equal(0n); // threshold is 2, so the timelock has not started
      expect(proposal.executed).to.equal(false);
    });

    it("rejects a non-signer, including the registries' own admin", async function () {
      const w = await loadFixture(worldFixture);
      const target = await w.products.getAddress();
      await expect(w.multisig.connect(w.outsider).propose(target, "0x"))
        .to.be.revertedWithCustomError(w.multisig, "NotAnOwner")
        .withArgs(w.outsider.address);
      await expect(w.multisig.connect(w.admin).propose(target, "0x"))
        .to.be.revertedWithCustomError(w.multisig, "NotAnOwner")
        .withArgs(w.admin.address);
    });

    it("rejects a target that is not a contract (a call to a wallet would silently do nothing)", async function () {
      const w = await loadFixture(worldFixture);
      await expect(w.multisig.connect(w.s1).propose(w.outsider.address, "0x1234"))
        .to.be.revertedWithCustomError(w.multisig, "TargetNotAContract")
        .withArgs(w.outsider.address);
    });

    it("starts the timelock immediately when the threshold is 1", async function () {
      const w = await loadFixture(worldFixture);
      const solo = await (await ethers.getContractFactory("AdminMultisig")).deploy([w.s1.address], 1, DELAY);
      const target = await w.products.getAddress();
      await expect(solo.connect(w.s1).propose(target, "0x")).to.emit(solo, "ProposalReady");
      const proposal = await solo.getProposal(1);
      expect(proposal.executableAt).to.equal((await time.latest()) + DELAY);
    });

    it("getProposal reverts ProposalNotFound for 0 and for an ID that does not exist", async function () {
      const { multisig } = await loadFixture(worldFixture);
      await expect(multisig.getProposal(0)).to.be.revertedWithCustomError(multisig, "ProposalNotFound").withArgs(0);
      await expect(multisig.getProposal(1)).to.be.revertedWithCustomError(multisig, "ProposalNotFound").withArgs(1);
    });
  });

  describe("approve", function () {
    it("the approval that reaches the threshold starts the timelock", async function () {
      const w = await loadFixture(worldFixture);
      const target = await w.products.getAddress();
      await w.multisig.connect(w.s1).propose(target, "0x12345678");

      const tx = await w.multisig.connect(w.s2).approve(1);
      const block = await ethers.provider.getBlock("latest");
      await expect(tx)
        .to.emit(w.multisig, "ProposalApproved")
        .withArgs(1, w.s2.address, 2)
        .and.to.emit(w.multisig, "ProposalReady")
        .withArgs(1, block.timestamp + DELAY);
      expect((await w.multisig.getProposal(1)).executableAt).to.equal(block.timestamp + DELAY);
    });

    it("a further approval after the threshold does not restart the timelock", async function () {
      const w = await loadFixture(worldFixture);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await w.multisig.connect(w.s2).approve(1);
      const before = (await w.multisig.getProposal(1)).executableAt;
      await time.increase(100);
      await w.multisig.connect(w.s3).approve(1);
      const proposal = await w.multisig.getProposal(1);
      expect(proposal.approvals).to.equal(3n);
      expect(proposal.executableAt).to.equal(before);
    });

    it("rejects a double approval, a non-signer and an unknown proposal", async function () {
      const w = await loadFixture(worldFixture);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await expect(w.multisig.connect(w.s1).approve(1))
        .to.be.revertedWithCustomError(w.multisig, "AlreadyApproved")
        .withArgs(1, w.s1.address);
      await expect(w.multisig.connect(w.outsider).approve(1))
        .to.be.revertedWithCustomError(w.multisig, "NotAnOwner")
        .withArgs(w.outsider.address);
      await expect(w.multisig.connect(w.s2).approve(0)).to.be.revertedWithCustomError(w.multisig, "ProposalNotFound");
      await expect(w.multisig.connect(w.s2).approve(99))
        .to.be.revertedWithCustomError(w.multisig, "ProposalNotFound")
        .withArgs(99);
    });
  });

  describe("revokeApproval (how signers cancel during the waiting time)", function () {
    it("withdraws an approval and emits ApprovalRevoked", async function () {
      const w = await loadFixture(worldFixture);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await expect(w.multisig.connect(w.s1).revokeApproval(1))
        .to.emit(w.multisig, "ApprovalRevoked")
        .withArgs(1, w.s1.address, 0);
      expect(await w.multisig.hasApproved(1, w.s1.address)).to.equal(false);
      expect((await w.multisig.getProposal(1)).approvals).to.equal(0n);
    });

    it("dropping below the threshold blocks the action and RESETS the timelock", async function () {
      const w = await loadFixture(worldFixture);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await w.multisig.connect(w.s2).approve(1);
      expect((await w.multisig.getProposal(1)).executableAt).to.not.equal(0n);

      await w.multisig.connect(w.s2).revokeApproval(1);
      expect((await w.multisig.getProposal(1)).executableAt).to.equal(0n);
      await time.increase(DELAY * 2);
      await expect(w.multisig.execute(1))
        .to.be.revertedWithCustomError(w.multisig, "NotEnoughApprovals")
        .withArgs(1, 1, 2);

      // Approving again starts a brand-new timelock from now.
      await w.multisig.connect(w.s2).approve(1);
      const latest = await time.latest();
      expect((await w.multisig.getProposal(1)).executableAt).to.equal(latest + DELAY);
      await expect(w.multisig.execute(1)).to.be.revertedWithCustomError(w.multisig, "TimelockNotElapsed");
    });

    it("withdrawing while still above the threshold keeps the timelock running", async function () {
      const w = await loadFixture(worldFixture);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await w.multisig.connect(w.s2).approve(1);
      await w.multisig.connect(w.s3).approve(1); // 3 approvals, threshold 2
      const before = (await w.multisig.getProposal(1)).executableAt;
      await w.multisig.connect(w.s3).revokeApproval(1); // back to exactly 2
      expect((await w.multisig.getProposal(1)).executableAt).to.equal(before);
    });

    it("rejects: no approval to withdraw, a non-signer, an unknown proposal", async function () {
      const w = await loadFixture(worldFixture);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await expect(w.multisig.connect(w.s2).revokeApproval(1))
        .to.be.revertedWithCustomError(w.multisig, "NotApproved")
        .withArgs(1, w.s2.address);
      await expect(w.multisig.connect(w.outsider).revokeApproval(1)).to.be.revertedWithCustomError(
        w.multisig,
        "NotAnOwner"
      );
      await expect(w.multisig.connect(w.s1).revokeApproval(7))
        .to.be.revertedWithCustomError(w.multisig, "ProposalNotFound")
        .withArgs(7);
    });
  });

  describe("execute (with the real registries)", function () {
    it("needs enough approvals first", async function () {
      const w = await loadFixture(worldFixture);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await expect(w.multisig.execute(1))
        .to.be.revertedWithCustomError(w.multisig, "NotEnoughApprovals")
        .withArgs(1, 1, 2);
    });

    it("waits for the timelock, then runs the action AS the multisig; anyone may trigger it", async function () {
      const w = await loadFixture(worldFixture);
      await handOver(w, w.products);
      const data = encode(w.products, "verifyBrand", [w.brand.address, "Fastrack"]);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), data);
      const id = await w.multisig.proposalCount();
      await w.multisig.connect(w.s2).approve(id);

      const { executableAt } = await w.multisig.getProposal(id);
      await expect(w.multisig.connect(w.outsider).execute(id))
        .to.be.revertedWithCustomError(w.multisig, "TimelockNotElapsed")
        .withArgs(id, executableAt);
      expect((await w.products.getBrand(w.brand.address)).verified).to.equal(false);

      await time.increaseTo(executableAt);
      await expect(w.multisig.connect(w.outsider).execute(id))
        .to.emit(w.multisig, "ProposalExecuted")
        .withArgs(id, w.outsider.address)
        .and.to.emit(w.products, "BrandVerified")
        .withArgs(w.brand.address, "Fastrack");
      expect((await w.products.getBrand(w.brand.address)).verified).to.equal(true);
      expect((await w.multisig.getProposal(id)).executed).to.equal(true);
    });

    it("cannot be executed twice, approved or withdrawn after execution", async function () {
      const w = await loadFixture(worldFixture);
      await handOver(w, w.products);
      const id = await runProposal(w, await w.products.getAddress(), encode(w.products, "verifyBrand", [w.brand.address, "F"]));
      await expect(w.multisig.execute(id)).to.be.revertedWithCustomError(w.multisig, "ProposalAlreadyExecuted").withArgs(id);
      await expect(w.multisig.connect(w.s3).approve(id)).to.be.revertedWithCustomError(w.multisig, "ProposalAlreadyExecuted");
      await expect(w.multisig.connect(w.s1).revokeApproval(id)).to.be.revertedWithCustomError(
        w.multisig,
        "ProposalAlreadyExecuted"
      );
    });

    it("passes on the called contract's own error, and leaves the proposal open to retry", async function () {
      const w = await loadFixture(worldFixture);
      // The multisig does NOT own the registry yet, so verifyBrand will fail with NotOwner(multisig).
      const data = encode(w.products, "verifyBrand", [w.brand.address, "Fastrack"]);
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), data);
      await w.multisig.connect(w.s2).approve(1);
      await time.increase(DELAY);

      await expect(w.multisig.execute(1))
        .to.be.revertedWithCustomError(w.products, "NotOwner")
        .withArgs(await w.multisig.getAddress());
      expect((await w.multisig.getProposal(1)).executed).to.equal(false); // everything was undone

      // Fix the cause (hand over ownership), then the very same proposal works.
      await handOver(w, w.products);
      await expect(w.multisig.execute(1)).to.emit(w.products, "BrandVerified");
    });

    it("reports ExecutionFailed when the called contract reverts without a reason", async function () {
      const w = await loadFixture(worldFixture);
      // 0x12345678 is not a function of ProductRegistry (and it has no fallback), so the call reverts with no data.
      await w.multisig.connect(w.s1).propose(await w.products.getAddress(), "0x12345678");
      await w.multisig.connect(w.s2).approve(1);
      await time.increase(DELAY);
      await expect(w.multisig.execute(1)).to.be.revertedWithCustomError(w.multisig, "ExecutionFailed").withArgs(1);
    });

    it("with a delay of 0, the action can run as soon as enough signers approved", async function () {
      const w = await loadFixture(worldFixture);
      const instant = await (await ethers.getContractFactory("AdminMultisig")).deploy(
        [w.s1.address, w.s2.address],
        2,
        0
      );
      await w.products.transferOwnership(await instant.getAddress());
      const target = await w.products.getAddress();
      await instant.connect(w.s1).propose(target, encode(w.products, "acceptOwnership"));
      await instant.connect(w.s2).approve(1);
      await expect(instant.execute(1)).to.emit(w.products, "OwnershipTransferred");
      expect(await w.products.owner()).to.equal(await instant.getAddress());
    });
  });

  describe("ETH handling", function () {
    it("reverts when ETH is sent to the multisig (no receive/fallback)", async function () {
      const { multisig, admin } = await loadFixture(worldFixture);
      await expect(admin.sendTransaction({ to: await multisig.getAddress(), value: 1n })).to.be.reverted;
    });

    it("reverts when ETH is attached to a call, or sent with unknown calldata", async function () {
      const { multisig, s1, admin, products } = await loadFixture(worldFixture);
      await expect(multisig.connect(s1).propose(await products.getAddress(), "0x12345678", { value: 1n })).to.be.reverted;
      await expect(admin.sendTransaction({ to: await multisig.getAddress(), value: 1n, data: "0x12345678" })).to.be
        .reverted;
    });
  });
});
