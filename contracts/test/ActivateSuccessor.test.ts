import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import { MissionStatus, baseConfig, createMission, currentTimestamp, signMandate } from './helpers';

describe('SuccraMission.activateSuccessor', () => {
  let factory: Contract;
  let mission: Contract;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let guardian: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let primary: Wallet;
  let beta: Wallet;
  let gamma: Wallet;
  let merchant: string;
  let token: string;
  let now: bigint;

  beforeEach(async () => {
    const [deployer, guardianSigner, otherSigner] = await ethers.getSigners();
    owner = deployer;
    guardian = guardianSigner;
    other = otherSigner;
    primary = ethers.Wallet.createRandom();
    beta = ethers.Wallet.createRandom();
    gamma = ethers.Wallet.createRandom();
    merchant = ethers.Wallet.createRandom().address;
    token = ethers.Wallet.createRandom().address;
    now = await currentTimestamp();

    const Registry = await ethers.getContractFactory('GuardianRegistry');
    const registry = await Registry.deploy(guardian.address);
    await registry.waitForDeployment();
    const Factory = await ethers.getContractFactory('MissionFactory');
    factory = await Factory.deploy(await registry.getAddress());
    await factory.waitForDeployment();

    const config = await baseConfig(primary.address, beta.address, merchant, token, {
      successors: [
        { agent: beta.address, priority: 1, active: true },
        { agent: gamma.address, priority: 2, active: true },
      ],
    });
    const created = await createMission(factory, config, owner);
    mission = created.mission;
  });

  async function quarantine(): Promise<void> {
    const version = (await mission.authority()).stateVersion as bigint;
    await mission.connect(guardian).quarantine(version);
  }

  it('activates an approved successor from QUARANTINED', async () => {
    await quarantine();
    const version = (await mission.authority()).stateVersion as bigint;
    const priorHash = (await mission.authority()).lastCheckpointHash as string;

    const tx = await mission.connect(guardian).activateSuccessor(beta.address, version);
    const receipt = await tx.wait();
    const events = receipt.logs.map((log) => mission.interface.parseLog(log));
    const activated = events.find((event) => event?.name === 'SuccessorActivated');
    const status = events.find((event) => event?.name === 'MissionStatusChanged');

    expect(activated?.args[0]).to.equal(beta.address);
    expect(activated?.args[1]).to.equal(priorHash);
    expect(status?.args[0]).to.equal(MissionStatus.QUARANTINED);
    expect(status?.args[1]).to.equal(MissionStatus.RECOVERING);

    const authority = await mission.authority();
    expect(authority.currentAgent).to.equal(beta.address);
    expect(authority.status).to.equal(MissionStatus.RECOVERING);
    expect(authority.stateVersion).to.equal(version + 1n);
  });

  it('rejects activation by the owner', async () => {
    await quarantine();
    const version = (await mission.authority()).stateVersion as bigint;
    await expect(
      mission.connect(owner).activateSuccessor(beta.address, version)
    ).to.be.revertedWithCustomError(mission, 'NotGuardian');
  });

  it('rejects an address that is not pre-approved', async () => {
    await quarantine();
    const version = (await mission.authority()).stateVersion as bigint;
    await expect(
      mission.connect(guardian).activateSuccessor(other.address, version)
    ).to.be.revertedWithCustomError(mission, 'NotActiveSuccessor');
  });

  it('rejects an inactive successor', async () => {
    const config = await baseConfig(primary.address, beta.address, merchant, token, {
      successors: [{ agent: beta.address, priority: 1, active: false }],
    });
    const created = await createMission(factory, config, owner);
    const inactiveMission = created.mission;
    await inactiveMission.connect(guardian).quarantine(0);
    await expect(
      inactiveMission.connect(guardian).activateSuccessor(beta.address, 1)
    ).to.be.revertedWithCustomError(inactiveMission, 'NotActiveSuccessor');
  });

  it('rejects the current agent from being reactivated', async () => {
    await quarantine();
    let version = (await mission.authority()).stateVersion as bigint;
    await mission.connect(guardian).activateSuccessor(beta.address, version);
    version = (await mission.authority()).stateVersion as bigint;
    await expect(
      mission.connect(guardian).activateSuccessor(beta.address, version)
    ).to.be.revertedWithCustomError(mission, 'CannotReactivatePrimary');
  });

  it('allows retry with a different successor from RECOVERING', async () => {
    await quarantine();
    let version = (await mission.authority()).stateVersion as bigint;
    await mission.connect(guardian).activateSuccessor(beta.address, version);
    version = (await mission.authority()).stateVersion as bigint;
    await mission.connect(guardian).activateSuccessor(gamma.address, version);

    const authority = await mission.authority();
    expect(authority.currentAgent).to.equal(gamma.address);
    expect(authority.status).to.equal(MissionStatus.RECOVERING);
  });

  it('rejects a non-quarantined/non-recovering mission', async () => {
    await expect(
      mission.connect(guardian).activateSuccessor(beta.address, 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidStatus');
  });

  it('rejects a stale expected version', async () => {
    await quarantine();
    const version = (await mission.authority()).stateVersion as bigint;
    await expect(
      mission.connect(guardian).activateSuccessor(beta.address, version - 1n)
    ).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });

  it('resets the successor agent nonce on activation', async () => {
    const mandateHash = ethers.id('mandate-before-quarantine');
    await mission.authorizePayment(
      {
        requestId: ethers.id('request-before-quarantine'),
        agent: primary.address,
        merchant,
        token,
        amountAtomic: 100n,
        paymentNonce: 7n,
        expiresAt: now + 3_600n,
        mandateHash,
        agentSignature: signMandate(primary, mandateHash),
      },
      0
    );
    await quarantine();
    const version = (await mission.authority()).stateVersion as bigint;
    await mission.connect(guardian).activateSuccessor(beta.address, version);
    expect((await mission.authority()).agentNonce).to.equal(0n);
  });

  it('exposes successorCount', async () => {
    expect(await mission.successorCount()).to.equal(2n);
  });
});
