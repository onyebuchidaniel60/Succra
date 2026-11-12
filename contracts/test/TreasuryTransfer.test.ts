import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import {
  baseConfig,
  createMission,
  deployRegistryAndFactory,
  impersonate,
  MissionStatus,
  setAuthorityStatus,
} from './helpers';

describe('SuccraMission.executeERC20Transfer', () => {
  let factory: Contract;
  let token: Contract;
  let mission: Contract;
  let missionAddress: string;
  let deployer: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let guardian: Wallet;
  let guardianSigner: Awaited<ReturnType<typeof impersonate>>;
  let primary: Wallet;
  let successor: Wallet;
  let merchant: string;

  beforeEach(async () => {
    const deployed = await deployRegistryAndFactory();
    factory = deployed.factory;
    deployer = deployed.deployer;
    guardian = deployed.guardian;
    guardianSigner = await impersonate(guardian.address);
    primary = ethers.Wallet.createRandom();
    successor = ethers.Wallet.createRandom();
    merchant = ethers.Wallet.createRandom().address;

    const Token = await ethers.getContractFactory('MockERC3009Token');
    token = await Token.deploy('World is Flat', 'WIF', 18);
    await token.waitForDeployment();
    await token.mint(deployer.address, 10_000n);

    const config = await baseConfig(
      primary.address,
      successor.address,
      merchant,
      await token.getAddress(),
      {
        budgetAtomic: 1_000n,
        initialDepositAtomic: 500n,
        maxPaymentAtomic: 400n,
        recoveryMaxPaymentAtomic: 100n,
      }
    );
    const created = await createMission(factory, config);
    mission = created.mission;
    missionAddress = created.missionAddress;
    await token.approve(missionAddress, 1_000n);
    await mission.deposit(500n);
  });

  it('executes an allowlisted ERC-20 transfer and updates spent/available state', async () => {
    await expect(
      mission.connect(guardianSigner).executeERC20Transfer(
        await token.getAddress(),
        merchant,
        100n
      )
    )
      .to.emit(mission, 'TreasuryTransfer')
      .withArgs(await token.getAddress(), merchant, 100n, 1n);

    const authority = await mission.authority();
    expect(authority.confirmedSpentAtomic).to.equal(100n);
    expect(authority.violationCount).to.equal(0);
    expect(await mission.availableBalance()).to.equal(400n);
    expect(await token.balanceOf(merchant)).to.equal(100n);
  });

  it('blocks an over-cap transfer, records a violation, and moves no funds', async () => {
    const before = await token.balanceOf(merchant);
    await expect(
      mission.connect(guardianSigner).executeERC20Transfer(
        await token.getAddress(),
        merchant,
        401n
      )
    ).to.emit(mission, 'TreasuryTransferBlocked');

    const authority = await mission.authority();
    expect(authority.violationCount).to.equal(1);
    expect(authority.confirmedSpentAtomic).to.equal(0n);
    expect(await token.balanceOf(merchant)).to.equal(before);
  });

  it('blocks a non-allowlisted merchant and a non-configured token', async () => {
    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(await token.getAddress(), ethers.Wallet.createRandom().address, 100n);
    expect((await mission.authority()).violationCount).to.equal(1);

    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(ethers.Wallet.createRandom().address, merchant, 100n);
    expect((await mission.authority()).violationCount).to.equal(2);
    expect(await token.balanceOf(merchant)).to.equal(0n);
  });

  it('blocks a zero amount and a transfer above the available balance', async () => {
    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(await token.getAddress(), merchant, 0n);
    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(await token.getAddress(), merchant, 501n);
    const authority = await mission.authority();
    expect(authority.violationCount).to.equal(2);
    expect(await mission.availableBalance()).to.equal(500n);
  });

  it('resets the violation streak after a successful treasury transfer', async () => {
    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(await token.getAddress(), merchant, 401n);
    expect((await mission.authority()).violationCount).to.equal(1);

    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(await token.getAddress(), merchant, 100n);
    expect((await mission.authority()).violationCount).to.equal(0);
    expect(await token.balanceOf(merchant)).to.equal(100n);
  });

  it('rejects callers that are not the guardian', async () => {
    await expect(
      mission.executeERC20Transfer(await token.getAddress(), merchant, 100n)
    ).to.be.revertedWithCustomError(mission, 'NotGuardian');
  });

  it('rejects treasury transfers outside an executable mission status', async () => {
    await mission.connect(guardianSigner).quarantine(0);
    await expect(
      mission
        .connect(guardianSigner)
        .executeERC20Transfer(await token.getAddress(), merchant, 100n)
    ).to.be.revertedWithCustomError(mission, 'InvalidStatus');
  });

  it('uses the lower recovery ceiling in ACTIVE_RECOVERY', async () => {
    await setAuthorityStatus(mission, MissionStatus.ACTIVE_RECOVERY);
    expect((await mission.authority()).status).to.equal(
      BigInt(MissionStatus.ACTIVE_RECOVERY)
    );

    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(await token.getAddress(), merchant, 101n);
    expect((await mission.authority()).violationCount).to.equal(1);
    expect(await token.balanceOf(merchant)).to.equal(0n);

    await mission
      .connect(guardianSigner)
      .executeERC20Transfer(await token.getAddress(), merchant, 100n);
    expect(await token.balanceOf(merchant)).to.equal(100n);
    expect((await mission.authority()).violationCount).to.equal(0);
  });
});
