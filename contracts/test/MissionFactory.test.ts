import { expect } from 'chai';
import { ethers } from 'hardhat';
import { baseConfig, createMission, deployRegistryAndFactory, MissionStatus } from './helpers';

describe('MissionFactory', () => {
  it('rejects a zero guardian registry in the constructor', async () => {
    const Factory = await ethers.getContractFactory('MissionFactory');
    await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Factory,
      'InvalidGuardianRegistry'
    );
  });

  it('deploys a mission owned by msg.sender', async () => {
    const { factory, deployer } = await deployRegistryAndFactory();
    const primary = ethers.Wallet.createRandom();
    const successor = ethers.Wallet.createRandom();
    const config = await baseConfig(
      primary.address,
      successor.address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address
    );

    const { mission, missionAddress } = await createMission(factory, config);

    expect(await mission.owner()).to.equal(deployer.address);
    expect(missionAddress).to.not.equal(ethers.ZeroAddress);
    expect(Number((await mission.authority()).status)).to.equal(MissionStatus.ACTIVE);
    expect(await factory.totalMissions()).to.equal(1n);
    expect(await factory.getMissionAt(0)).to.equal(missionAddress);
    expect(await factory.getMissionsByOwner(deployer.address)).to.deep.equal([missionAddress]);
  });

  it('uses the caller, not a config field, as owner', async () => {
    const { factory, other } = await deployRegistryAndFactory();
    const config = await baseConfig(
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address
    );

    const { mission } = await createMission(factory, config, other);
    expect(await mission.owner()).to.equal(other.address);
  });

  it('indexes multiple missions for the same owner', async () => {
    const { factory, deployer } = await deployRegistryAndFactory();
    const first = await createMission(
      factory,
      await baseConfig(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      )
    );
    const second = await createMission(
      factory,
      await baseConfig(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      )
    );

    expect(await factory.totalMissions()).to.equal(2n);
    expect(await factory.getMissionAt(0)).to.equal(first.missionAddress);
    expect(await factory.getMissionAt(1)).to.equal(second.missionAddress);
    expect(await factory.getMissionsByOwner(deployer.address)).to.deep.equal([
      first.missionAddress,
      second.missionAddress,
    ]);
  });

  it('isolates missions by owner', async () => {
    const { factory, deployer, other } = await deployRegistryAndFactory();
    const first = await createMission(
      factory,
      await baseConfig(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      )
    );
    const second = await createMission(
      factory,
      await baseConfig(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      ),
      other
    );

    expect(await factory.getMissionsByOwner(deployer.address)).to.deep.equal([
      first.missionAddress,
    ]);
    expect(await factory.getMissionsByOwner(other.address)).to.deep.equal([second.missionAddress]);
  });

  it('propagates the guardian from the registry', async () => {
    const { factory, registry, guardian, other } = await deployRegistryAndFactory();
    const first = await createMission(
      factory,
      await baseConfig(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      )
    );
    expect(await first.mission.guardian()).to.equal(guardian.address);

    await registry.rotateGuardian(other.address);
    const second = await createMission(
      factory,
      await baseConfig(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      )
    );
    expect(await second.mission.guardian()).to.equal(other.address);
  });

  it('emits MissionFactoryMissionDeployed', async () => {
    const { factory, deployer } = await deployRegistryAndFactory();
    const config = await baseConfig(
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address
    );
    const tx = await factory.createMission(config);
    const receipt = await tx.wait();
    const total = await factory.totalMissions();
    const missionAddress = await factory.getMissionAt(total - 1n);
    await expect(tx)
      .to.emit(factory, 'MissionFactoryMissionDeployed')
      .withArgs(deployer.address, missionAddress);
    expect(receipt).to.not.equal(null);
  });
});
