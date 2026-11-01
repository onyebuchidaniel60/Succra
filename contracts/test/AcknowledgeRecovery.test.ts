import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import { MissionStatus, baseConfig, createMission, impersonate, signRecoveryAck } from './helpers';

describe('SuccraMission.acknowledgeRecovery', () => {
  let factory: Contract;
  let mission: Contract;
  let missionAddress: string;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let guardian: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let primary: Wallet;
  let beta: Wallet;
  let gamma: Wallet;
  let merchant: string;
  let token: string;

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
    missionAddress = created.missionAddress;
  });

  async function primeRecovery(): Promise<bigint> {
    await mission.connect(guardian).quarantine(0);
    await mission.connect(guardian).activateSuccessor(beta.address, 1);
    return (await mission.authority()).stateVersion as bigint;
  }

  it('accepts a direct acknowledgement from the current agent', async () => {
    const version = await primeRecovery();
    const signer = await impersonate(beta.address);
    await expect(mission.connect(signer).acknowledgeRecovery(version, '0x'))
      .to.emit(mission, 'RecoveryAcknowledged')
      .withArgs(beta.address, version + 1n);
    const authority = await mission.authority();
    expect(authority.status).to.equal(MissionStatus.ACTIVE_RECOVERY);
    await ethers.provider.send('hardhat_stopImpersonatingAccount', [beta.address]);
  });

  it('accepts a guardian-submitted acknowledgement with a valid signature', async () => {
    const version = await primeRecovery();
    const signature = signRecoveryAck(beta, missionAddress, version);
    await mission.connect(guardian).acknowledgeRecovery(version, signature);
    expect((await mission.authority()).status).to.equal(MissionStatus.ACTIVE_RECOVERY);
  });

  it('rejects a guardian-submitted acknowledgement with an invalid signature', async () => {
    const version = await primeRecovery();
    const signature = signRecoveryAck(gamma, missionAddress, version);
    await expect(
      mission.connect(guardian).acknowledgeRecovery(version, signature)
    ).to.be.revertedWithCustomError(mission, 'InvalidAcknowledgement');
  });

  it('rejects a third-party caller', async () => {
    const version = await primeRecovery();
    const signature = signRecoveryAck(beta, missionAddress, version);
    await expect(
      mission.connect(other).acknowledgeRecovery(version, signature)
    ).to.be.revertedWithCustomError(mission, 'NotAuthorized');
  });

  it('rejects acknowledgement outside RECOVERING', async () => {
    await expect(
      mission.connect(guardian).acknowledgeRecovery(0, '0x')
    ).to.be.revertedWithCustomError(mission, 'NotInRecovering');
  });

  it('rejects a stale expected version', async () => {
    const version = await primeRecovery();
    const signature = signRecoveryAck(beta, missionAddress, version);
    await expect(
      mission.connect(guardian).acknowledgeRecovery(version - 1n, signature)
    ).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });
});
