import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import { MissionStatus, baseConfig, createMission, setAuthorityStatus } from './helpers';

describe('SuccraMission.recordViolation', () => {
  let factory: Contract;
  let registry: Contract;
  let mission: Contract;
  let guardian: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let primary: Wallet;
  let merchant: string;
  let token: string;

  beforeEach(async () => {
    const [deployer, guardianSigner, otherSigner] = await ethers.getSigners();
    guardian = guardianSigner;
    other = otherSigner;
    primary = ethers.Wallet.createRandom();
    merchant = ethers.Wallet.createRandom().address;
    token = ethers.Wallet.createRandom().address;

    const Registry = await ethers.getContractFactory('GuardianRegistry');
    registry = await Registry.deploy(guardian.address);
    await registry.waitForDeployment();
    const Factory = await ethers.getContractFactory('MissionFactory');
    factory = await Factory.deploy(await registry.getAddress());
    await factory.waitForDeployment();

    const config = await baseConfig(
      primary.address,
      ethers.Wallet.createRandom().address,
      merchant,
      token
    );
    const created = await createMission(factory, config, deployer);
    mission = created.mission;
  });

  async function version(): Promise<bigint> {
    return (await mission.authority()).stateVersion as bigint;
  }

  it('increments violationCount, sets lastViolationAt, and advances stateVersion', async () => {
    const requestId = ethers.id('violation-1');
    await expect(mission.connect(guardian).recordViolation(requestId, 0))
      .to.emit(mission, 'ViolationRecorded')
      .withArgs(requestId, 1, 1n);

    const authority = await mission.authority();
    expect(authority.violationCount).to.equal(1);
    expect(authority.lastViolationAt).to.be.greaterThan(0n);
    expect(authority.stateVersion).to.equal(1n);
    expect(await mission.recordedViolations(requestId)).to.equal(true);
  });

  it('rejects a duplicate request id', async () => {
    const requestId = ethers.id('violation-1');
    await mission.connect(guardian).recordViolation(requestId, 0);
    await expect(
      mission.connect(guardian).recordViolation(requestId, 1)
    ).to.be.revertedWithCustomError(mission, 'ViolationAlreadyRecorded');
  });

  it('rejects a caller that is not the guardian', async () => {
    await expect(
      mission.connect(other).recordViolation(ethers.id('violation-1'), 0)
    ).to.be.revertedWithCustomError(mission, 'NotGuardian');
  });

  it('records a violation while the mission is ACTIVE_RECOVERY', async () => {
    await setAuthorityStatus(mission, MissionStatus.ACTIVE_RECOVERY);
    await mission.connect(guardian).recordViolation(ethers.id('violation-1'), 0);
    const authority = await mission.authority();
    expect(authority.status).to.equal(MissionStatus.ACTIVE_RECOVERY);
    expect(authority.violationCount).to.equal(1);
  });

  it('rejects a non-ACTIVE/ACTIVE_RECOVERY status', async () => {
    await mission.cancel(0);
    await expect(
      mission.connect(guardian).recordViolation(ethers.id('violation-1'), 1)
    ).to.be.revertedWithCustomError(mission, 'InvalidStatus');
  });

  it('rejects a stale expectedVersion', async () => {
    await mission.connect(guardian).recordViolation(ethers.id('violation-1'), 0);
    await expect(
      mission.connect(guardian).recordViolation(ethers.id('violation-2'), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });

  it('resets violationCount when the violation window has expired', async () => {
    await mission.connect(guardian).recordViolation(ethers.id('violation-1'), 0);
    await ethers.provider.send('evm_increaseTime', [901]);
    await ethers.provider.send('evm_mine', []);

    await mission.connect(guardian).recordViolation(ethers.id('violation-2'), 1);
    expect((await mission.authority()).violationCount).to.equal(1);
  });

  it('does not reset when the violation window has not expired', async () => {
    await mission.connect(guardian).recordViolation(ethers.id('violation-1'), 0);
    await ethers.provider.send('evm_increaseTime', [10]);
    await ethers.provider.send('evm_mine', []);

    await mission.connect(guardian).recordViolation(ethers.id('violation-2'), 1);
    expect((await mission.authority()).violationCount).to.equal(2);
  });

  it('emits ViolationRecorded with the updated count and state version', async () => {
    await mission.connect(guardian).recordViolation(ethers.id('violation-1'), 0);
    const requestId = ethers.id('violation-2');
    await expect(mission.connect(guardian).recordViolation(requestId, 1))
      .to.emit(mission, 'ViolationRecorded')
      .withArgs(requestId, 2, 2n);
    expect(await version()).to.equal(2n);
  });
});
