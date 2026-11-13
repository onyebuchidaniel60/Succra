import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import {
  baseConfig,
  createMission,
  currentTimestamp,
  deployRegistryAndFactory,
  impersonate,
} from './helpers';

const MAGIC = '0x1626ba7e';
const INVALID = '0xffffffff';

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

describe('SuccraMission vault, session key, and ERC-1271', () => {
  let factory: Contract;
  let token: Contract;
  let mission: Contract;
  let missionAddress: string;
  let deployer: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let primary: Wallet;
  let successor: Wallet;
  let sessionKey: Wallet;
  let merchant: string;
  let guardian: Wallet;
  let guardianSigner: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  async function deployVaultFixture() {
    const deployed = await deployRegistryAndFactory();
    factory = deployed.factory;
    deployer = deployed.deployer;
    guardian = deployed.guardian;
    guardianSigner = await impersonate(guardian.address);
    primary = ethers.Wallet.createRandom();
    successor = ethers.Wallet.createRandom();
    sessionKey = ethers.Wallet.createRandom();
    merchant = ethers.Wallet.createRandom().address;

    const Token = await ethers.getContractFactory('MockERC3009Token');
    token = await Token.deploy('Mock USDG', 'mUSDG', 6);
    await token.waitForDeployment();
    await token.mint(deployer.address, 10_000n);

    const config = await baseConfig(primary.address, successor.address, merchant, await token.getAddress(), {
      budgetAtomic: 1_000n,
      initialDepositAtomic: 500n,
      maxPaymentAtomic: 400n,
      recoveryMaxPaymentAtomic: 100n,
    });
    const created = await createMission(factory, config);
    mission = created.mission;
    missionAddress = created.missionAddress;

    await token.approve(missionAddress, 1_000n);
    await mission.deposit(500n);
  }

  beforeEach(async () => {
    await deployVaultFixture();
  });

  it('deposits, registers a session key, and exposes only the unallocated balance', async () => {
    const authority = await mission.authority();
    expect(authority.depositedAtomic).to.equal(500n);
    expect(await mission.availableBalance()).to.equal(500n);

    await expect(mission.registerSessionKey(sessionKey.address, 0))
      .to.emit(mission, 'SessionKeyRegistered')
      .withArgs(sessionKey.address, 1n);
    expect((await mission.authority()).sessionKey).to.equal(sessionKey.address);
  });

  it('approves a Variant A hash and validates the session key via ERC-1271', async () => {
    await mission.registerSessionKey(sessionKey.address, 0);
    const hash = ethers.id('variant-a-authorization');
    await expect(mission.connect(guardianSigner).approvePayment(hash, 100n, merchant, 1))
      .to.emit(mission, 'PaymentApproved')
      .withArgs(hash, 100n, merchant);

    const authority = await mission.authority();
    expect(authority.reservedAtomic).to.equal(100n);
    expect(await mission.approvedHashes(hash)).to.equal(true);

    const signature = sessionKey.signingKey.sign(hash).serialized;
    expect(await mission.isValidSignature(hash, signature)).to.equal(MAGIC);

    const wrong = ethers.Wallet.createRandom().signingKey.sign(hash).serialized;
    expect(await mission.isValidSignature(hash, wrong)).to.equal(INVALID);
    expect(await mission.isValidSignature(ethers.id('unapproved'), signature)).to.equal(INVALID);
  });

  it('records a Variant A settlement, frees the reserve, and lets the owner withdraw', async () => {
    await mission.registerSessionKey(sessionKey.address, 0);
    const hash = ethers.id('variant-a-settlement');
    await mission.connect(guardianSigner).approvePayment(hash, 100n, merchant, 1);
    await mission
      .connect(guardianSigner)
      .recordSettlement(hash, 100n, ethers.id('settlement-tx'), 2);

    const authority = await mission.authority();
    expect(authority.confirmedSpentAtomic).to.equal(100n);
    expect(authority.reservedAtomic).to.equal(0n);
    expect(await mission.availableBalance()).to.equal(400n);

    const before = await token.balanceOf(deployer.address);
    await expect(mission.withdraw(100n)).to.emit(mission, 'FundsWithdrawn');
    expect(await token.balanceOf(deployer.address)).to.equal(before + 100n);
    expect((await mission.authority()).withdrawnAtomic).to.equal(100n);
    expect(await mission.availableBalance()).to.equal(300n);
  });

  it('executes a real EIP-3009 transfer with the contract as from', async () => {
    await mission.registerSessionKey(sessionKey.address, 0);
    const now = await currentTimestamp();
    const nonce = ethers.id('erc3009-nonce');
    const message = {
      from: missionAddress,
      to: deployer.address,
      value: 100n,
      validAfter: 0n,
      validBefore: now + 3_600n,
      nonce,
    };
    const domain = {
      name: 'Mock USDG',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await token.getAddress(),
    };
    const hash = ethers.TypedDataEncoder.hash(
      domain,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      message
    );
    const signature = sessionKey.signingKey.sign(hash).serialized;

    await mission.connect(guardianSigner).approvePayment(hash, 100n, merchant, 1);
    const before = await token.balanceOf(deployer.address);
    await token.transferWithAuthorization(
      missionAddress,
      deployer.address,
      100n,
      0n,
      now + 3_600n,
      nonce,
      signature
    );
    expect(await token.balanceOf(deployer.address)).to.equal(before + 100n);
    expect(await token.authorizationState(missionAddress, nonce)).to.equal(true);
  });

  it('quarantine revokes the session key and blocks further approvals', async () => {
    await mission.registerSessionKey(sessionKey.address, 0);
    await mission.connect(guardianSigner).quarantine(1);
    expect((await mission.authority()).sessionKey).to.equal(ethers.ZeroAddress);

    await expect(
      mission.connect(guardianSigner).approvePayment(ethers.id('after-quarantine'), 1n, merchant, 2)
    ).to.be.revertedWithCustomError(mission, 'InvalidStatus');
  });

  it('enforces the factory token allowlist for USDG/WIF selection', async () => {
    const [owner] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('GuardianRegistry');
    const registry = await Registry.deploy(guardian.address);
    await registry.waitForDeployment();
    const Factory = await ethers.getContractFactory('MissionFactory');
    const restricted = await Factory.deploy(await registry.getAddress());
    await restricted.waitForDeployment();

    await restricted.setAllowedTokens([await token.getAddress()]);
    const randomToken = ethers.Wallet.createRandom().address;
    const invalid = await baseConfig(
      primary.address,
      successor.address,
      merchant,
      randomToken
    );
    await expect(restricted.createMission(invalid)).to.be.revertedWithCustomError(
      restricted,
      'InvalidToken'
    );

    const valid = await baseConfig(
      primary.address,
      successor.address,
      merchant,
      await token.getAddress()
    );
    await expect(restricted.connect(owner).createMission(valid)).to.emit(
      restricted,
      'MissionFactoryMissionDeployed'
    );
  });
});
