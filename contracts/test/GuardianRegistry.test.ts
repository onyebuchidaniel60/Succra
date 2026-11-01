import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('GuardianRegistry', () => {
  async function deploy() {
    const [owner, other, guardian, nextGuardian] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('GuardianRegistry');
    const registry = await Registry.deploy(guardian.address);
    await registry.waitForDeployment();
    return { Registry, registry, owner, other, guardian, nextGuardian };
  }

  it('sets the guardian and owner in the constructor', async () => {
    const { registry, owner, guardian } = await deploy();
    expect(await registry.guardian()).to.equal(guardian.address);
    expect(await registry.owner()).to.equal(owner.address);
  });

  it('rejects a zero-address guardian in the constructor', async () => {
    const Registry = await ethers.getContractFactory('GuardianRegistry');
    await expect(Registry.deploy(ethers.ZeroAddress)).to.be.reverted;
  });

  it('lets the owner rotate the guardian', async () => {
    const { registry, nextGuardian } = await deploy();
    await expect(registry.rotateGuardian(nextGuardian.address))
      .to.emit(registry, 'GuardianRotated')
      .withArgs(await registry.guardian(), nextGuardian.address);
    expect(await registry.guardian()).to.equal(nextGuardian.address);
  });

  it('rejects rotation by a non-owner', async () => {
    const { registry, other, nextGuardian } = await deploy();
    await expect(
      registry.connect(other).rotateGuardian(nextGuardian.address)
    ).to.be.revertedWithCustomError(registry, 'NotOwner');
    expect(await registry.guardian()).to.not.equal(nextGuardian.address);
  });

  it('rejects a zero-address rotation target', async () => {
    const { registry } = await deploy();
    await expect(registry.rotateGuardian(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      registry,
      'ZeroAddress'
    );
  });

  it('updates state after rotation', async () => {
    const { registry, nextGuardian, guardian } = await deploy();
    const previous = await registry.guardian();
    await registry.rotateGuardian(nextGuardian.address);
    expect(await registry.guardian()).to.equal(nextGuardian.address);
    expect(await registry.guardian()).to.not.equal(previous);
    expect(previous).to.equal(guardian.address);
  });
});
