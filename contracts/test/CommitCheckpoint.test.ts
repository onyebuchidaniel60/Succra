import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import { MissionStatus, baseConfig, createMission, setAuthorityStatus } from './helpers';

describe('SuccraMission.commitCheckpoint', () => {
  let factory: Contract;
  let mission: Contract;
  let missionAddress: string;
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
    const registry = await Registry.deploy(guardian.address);
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
    missionAddress = created.missionAddress;
  });

  async function version(): Promise<bigint> {
    return (await mission.authority()).stateVersion as bigint;
  }

  it('commits the initial sequence 0 checkpoint', async () => {
    const hash = ethers.id('checkpoint-0');
    await expect(mission.connect(guardian).commitCheckpoint(0, hash, 0))
      .to.emit(mission, 'CheckpointCommitted')
      .withArgs(0n, hash);

    const authority = await mission.authority();
    expect(authority.lastCheckpointHash).to.equal(hash);
    expect(authority.lastCheckpointSequence).to.equal(0n);
    expect(authority.checkpointCount).to.equal(1n);
    expect(authority.stateVersion).to.equal(1n);
    expect(await mission.checkpoints(0)).to.equal(hash);
  });

  it('increments sequences strictly after the initial commit', async () => {
    const first = ethers.id('checkpoint-0');
    const second = ethers.id('checkpoint-1');
    await mission.connect(guardian).commitCheckpoint(0, first, 0);
    await mission.connect(guardian).commitCheckpoint(1, second, 1);

    const authority = await mission.authority();
    expect(authority.lastCheckpointHash).to.equal(second);
    expect(authority.lastCheckpointSequence).to.equal(1n);
    expect(authority.checkpointCount).to.equal(2n);
    expect(await mission.checkpoints(1)).to.equal(second);
  });

  it('rejects a caller that is not the guardian', async () => {
    await expect(
      mission.connect(other).commitCheckpoint(0, ethers.id('checkpoint-0'), 0)
    ).to.be.revertedWithCustomError(mission, 'NotGuardian');
  });

  it('rejects a stale expected version', async () => {
    await expect(
      mission.connect(guardian).commitCheckpoint(0, ethers.id('checkpoint-0'), 1)
    ).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });

  it('rejects a sequence gap', async () => {
    await expect(
      mission.connect(guardian).commitCheckpoint(1, ethers.id('checkpoint-1'), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });

  it('rejects a duplicate sequence', async () => {
    await mission.connect(guardian).commitCheckpoint(0, ethers.id('checkpoint-0'), 0);
    await expect(
      mission.connect(guardian).commitCheckpoint(0, ethers.id('checkpoint-0b'), 1)
    ).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });

  it('rejects a checkpoint while the mission is quarantined', async () => {
    await mission.connect(guardian).quarantine(0);
    await expect(
      mission.connect(guardian).commitCheckpoint(0, ethers.id('checkpoint-0'), 1)
    ).to.be.revertedWithCustomError(mission, 'InvalidStatus');
  });

  it('allows a checkpoint in ACTIVE_RECOVERY', async () => {
    await setAuthorityStatus(mission, MissionStatus.ACTIVE_RECOVERY);
    await mission.connect(guardian).commitCheckpoint(0, ethers.id('checkpoint-0'), 0);
    expect((await mission.authority()).checkpointCount).to.equal(1n);
  });

  it('accepts and stores a hash built from the canonical fixed-order preimage', async () => {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const emptyItemsHash = ethers.keccak256(ethers.concat([]));
    const hash = ethers.keccak256(
      abi.encode(
        [
          'bytes32',
          'uint64',
          'bytes32',
          'bytes32',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'bytes32',
          'uint64',
        ],
        [
          ethers.id('mission-uuid'),
          0n,
          emptyItemsHash,
          emptyItemsHash,
          0n,
          400n,
          100n,
          1n,
          ethers.id('policy'),
          1_700_000_000n,
        ]
      )
    );
    await mission.connect(guardian).commitCheckpoint(0, hash, 0);
    expect(await mission.checkpoints(0)).to.equal(hash);
  });

  it('keeps checkpointCount and lastCheckpointSequence coherent', async () => {
    await mission.connect(guardian).commitCheckpoint(0, ethers.id('checkpoint-0'), 0);
    await mission.connect(guardian).commitCheckpoint(1, ethers.id('checkpoint-1'), 1);
    const authority = await mission.authority();
    expect(authority.checkpointCount).to.equal(2n);
    expect(authority.lastCheckpointSequence).to.equal(1n);
    expect(await version()).to.equal(2n);
    void missionAddress;
  });
});
