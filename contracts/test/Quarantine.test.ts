import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import { MissionStatus, baseConfig, createMission, setAuthorityStatus } from './helpers';

describe('SuccraMission.quarantine', () => {
  let factory: Contract;
  let registry: Contract;
  let mission: Contract;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let guardian: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let primary: Wallet;
  let merchant: string;
  let token: string;

  beforeEach(async () => {
    const [deployer, guardianSigner, otherSigner] = await ethers.getSigners();
    owner = deployer;
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
    const created = await createMission(factory, config, owner);
    mission = created.mission;
  });

  it('allows the owner to quarantine at any time', async () => {
    await mission.connect(owner).quarantine(0);
    const authority = await mission.authority();
    expect(authority.status).to.equal(MissionStatus.QUARANTINED);
    expect(authority.stateVersion).to.equal(1n);
  });

  it('allows the guardian to quarantine', async () => {
    await mission.connect(guardian).quarantine(0);
    expect((await mission.authority()).status).to.equal(MissionStatus.QUARANTINED);
  });

  it('rejects a caller that is neither owner nor guardian', async () => {
    await expect(mission.connect(other).quarantine(0)).to.be.revertedWithCustomError(
      mission,
      'NotGuardian'
    );
  });

  it('transitions ACTIVE to QUARANTINED', async () => {
    expect((await mission.authority()).status).to.equal(MissionStatus.ACTIVE);
    await mission.connect(owner).quarantine(0);
    expect((await mission.authority()).status).to.equal(MissionStatus.QUARANTINED);
  });

  it('transitions ACTIVE_RECOVERY to QUARANTINED', async () => {
    await setAuthorityStatus(mission, MissionStatus.ACTIVE_RECOVERY);
    expect((await mission.authority()).status).to.equal(MissionStatus.ACTIVE_RECOVERY);
    await mission.connect(owner).quarantine(0);
    expect((await mission.authority()).status).to.equal(MissionStatus.QUARANTINED);
  });

  it('rejects a stale expectedVersion', async () => {
    await expect(mission.connect(owner).quarantine(1)).to.be.revertedWithCustomError(
      mission,
      'InvalidVersion'
    );
  });

  it('rejects an already-quarantined mission', async () => {
    await mission.connect(owner).quarantine(0);
    await expect(mission.connect(owner).quarantine(1)).to.be.revertedWithCustomError(
      mission,
      'AlreadyQuarantined'
    );
  });

  it('emits MissionStatusChanged and MissionQuarantined', async () => {
    const tx = await mission.connect(guardian).quarantine(0);
    const receipt = await tx.wait();
    const events = receipt.logs.map((log) => mission.interface.parseLog(log));
    const statusChanged = events.find((event) => event?.name === 'MissionStatusChanged');
    const quarantined = events.find((event) => event?.name === 'MissionQuarantined');
    expect(statusChanged?.args[0]).to.equal(MissionStatus.ACTIVE);
    expect(statusChanged?.args[1]).to.equal(MissionStatus.QUARANTINED);
    expect(statusChanged?.args[2]).to.equal(1n);
    expect(quarantined?.args[0]).to.equal(guardian.address);
    expect(quarantined?.args[1]).to.equal(1n);
  });

  it('does not require a violation threshold for manual quarantine', async () => {
    expect((await mission.authority()).violationCount).to.equal(0);
    await mission.connect(owner).quarantine(0);
    await expect(mission.connect(owner).quarantine(1)).to.be.revertedWithCustomError(
      mission,
      'AlreadyQuarantined'
    );
    expect((await mission.authority()).status).to.equal(MissionStatus.QUARANTINED);
  });
});
