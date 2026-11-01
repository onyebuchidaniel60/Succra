import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import {
  MissionStatus,
  baseConfig,
  createMission,
  currentTimestamp,
  deployRegistryAndFactory,
  signMandate,
  type MissionConfigInput,
} from './helpers';

describe('SuccraMission', () => {
  let factory: Contract;
  let mission: Contract;
  let deployer: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let primary: Wallet;
  let successor: Wallet;
  let merchant: string;
  let token: string;
  let now: bigint;

  beforeEach(async () => {
    const deployed = await deployRegistryAndFactory();
    factory = deployed.factory;
    deployer = deployed.deployer;
    other = deployed.other;
    primary = ethers.Wallet.createRandom();
    successor = ethers.Wallet.createRandom();
    merchant = ethers.Wallet.createRandom().address;
    token = ethers.Wallet.createRandom().address;
    now = await currentTimestamp();

    const config = await baseConfig(primary.address, successor.address, merchant, token);
    const created = await createMission(factory, config);
    mission = created.mission;
  });

  function makeAuth(
    overrides: Partial<{
      requestId: string;
      agent: string;
      merchantAddress: string;
      tokenAddress: string;
      amountAtomic: bigint;
      paymentNonce: bigint;
      expiresAt: bigint;
      mandateHash: string;
      signer: Wallet;
    }> = {}
  ) {
    const mandateHash = overrides.mandateHash ?? ethers.id('mandate-1');
    const signer = overrides.signer ?? primary;
    return {
      requestId: overrides.requestId ?? ethers.id('request-1'),
      agent: overrides.agent ?? primary.address,
      merchant: overrides.merchantAddress ?? merchant,
      token: overrides.tokenAddress ?? token,
      amountAtomic: overrides.amountAtomic ?? 100n,
      paymentNonce: overrides.paymentNonce ?? 1n,
      expiresAt: overrides.expiresAt ?? now + 3_600n,
      mandateHash,
      agentSignature: signMandate(signer, mandateHash),
    };
  }

  async function expectCreateReverts(overrides: Partial<MissionConfigInput>, errorName: string) {
    const config = await baseConfig(primary.address, successor.address, merchant, token, overrides);
    await expect(factory.createMission(config)).to.be.revertedWithCustomError(mission, errorName);
  }

  it('starts ACTIVE, records the owner and guardian, and seeds authority', async () => {
    const authority = await mission.authority();
    expect(await mission.owner()).to.equal(deployer.address);
    expect(await mission.guardian()).to.equal(
      await (
        await ethers.getContractAt('GuardianRegistry', await factory.guardianRegistry())
      ).guardian()
    );
    expect(Number(authority.status)).to.equal(MissionStatus.ACTIVE);
    expect(authority.currentAgent).to.equal(primary.address);
    expect(authority.agentNonce).to.equal(0n);
    expect(authority.stateVersion).to.equal(0n);
    expect(authority.violationCount).to.equal(0n);
    expect(authority.confirmedSpentAtomic).to.equal(0n);
    expect(await mission.allowedMerchants(merchant)).to.equal(true);
    expect(await mission.successorPriority(successor.address)).to.equal(1n);
    expect(await mission.successorActive(successor.address)).to.equal(true);
    expect(await mission.getMerchantAllowlist()).to.deep.equal([merchant]);
    expect(await mission.getSuccessors()).to.deep.equal([[successor.address, 1n, true]]);
  });

  it('rejects invalid creation policy', async () => {
    await expectCreateReverts({ budgetAtomic: 0n }, 'InvalidAmount');
    await expectCreateReverts({ maxPaymentAtomic: 0n }, 'InvalidAmount');
    await expectCreateReverts({ maxPaymentAtomic: 1_001n }, 'InvalidAmount');
    await expectCreateReverts({ recoveryMaxPaymentAtomic: 0n }, 'InvalidAmount');
    await expectCreateReverts({ recoveryMaxPaymentAtomic: 401n }, 'InvalidAmount');
    await expectCreateReverts({ expiresAt: now - 1n }, 'InvalidExpiry');
    await expectCreateReverts({ merchantAllowlist: [] }, 'InvalidMerchant');
    await expectCreateReverts({ merchantAllowlist: [ethers.ZeroAddress] }, 'InvalidMerchant');
    await expectCreateReverts({ merchantAllowlist: [merchant, merchant] }, 'InvalidMerchant');
    await expectCreateReverts({ primaryAgent: ethers.ZeroAddress }, 'ZeroAddress');
    await expectCreateReverts({ violationThreshold: 0 }, 'InvalidViolationThreshold');
    await expectCreateReverts({ violationWindowSeconds: 0n }, 'InvalidViolationWindow');
    await expectCreateReverts(
      {
        successors: Array.from({ length: 9 }, () => ({
          agent: ethers.Wallet.createRandom().address,
          priority: 1,
          active: true,
        })),
      },
      'SuccessorLimitExceeded'
    );
    await expectCreateReverts(
      {
        successors: [
          { agent: successor.address, priority: 1, active: true },
          { agent: successor.address, priority: 2, active: true },
        ],
      },
      'SuccessorAlreadyExists'
    );
    await expectCreateReverts(
      { successors: [{ agent: primary.address, priority: 1, active: true }] },
      'PrimaryAgentInSuccessors'
    );
    await expectCreateReverts(
      {
        successors: [{ agent: ethers.ZeroAddress, priority: 1, active: true }],
      },
      'InvalidSuccessor'
    );
  });

  it('authorizes a valid payment and advances nonce/version without updating spend', async () => {
    const auth = makeAuth();
    await expect(mission.authorizePayment(auth, 0))
      .to.emit(mission, 'PaymentAuthorized')
      .withArgs(auth.requestId, auth.merchant, auth.amountAtomic, auth.mandateHash);

    const authority = await mission.authority();
    expect(authority.agentNonce).to.equal(1n);
    expect(authority.stateVersion).to.equal(1n);
    expect(authority.confirmedSpentAtomic).to.equal(0n);
    expect(await mission.usedRequestIds(auth.requestId)).to.equal(true);
  });

  it('rejects an invalid expected version', async () => {
    await expect(mission.authorizePayment(makeAuth(), 1)).to.be.revertedWithCustomError(
      mission,
      'InvalidVersion'
    );
  });

  it('rejects payment authorization when the mission is not ACTIVE/ACTIVE_RECOVERY', async () => {
    await mission.cancel(0);
    await expect(mission.authorizePayment(makeAuth(), 1)).to.be.revertedWithCustomError(
      mission,
      'InvalidStatus'
    );
  });

  it('rejects a payment from the wrong agent', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ agent: other.address }), 0)
    ).to.be.revertedWithCustomError(mission, 'NotCurrentAgent');
  });

  it('rejects an expired payment authorization', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ expiresAt: now - 1n }), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidExpiry');
  });

  it('rejects a payment after mission expiry', async () => {
    const shortConfig = await baseConfig(primary.address, successor.address, merchant, token, {
      expiresAt: now + 10n,
    });
    const created = await createMission(factory, shortConfig);
    await ethers.provider.send('evm_increaseTime', [20]);
    await ethers.provider.send('evm_mine', []);

    await expect(created.mission.authorizePayment(makeAuth(), 0)).to.be.revertedWithCustomError(
      created.mission,
      'InvalidExpiry'
    );
  });

  it('rejects a duplicate request id', async () => {
    const first = makeAuth({ requestId: ethers.id('duplicate'), mandateHash: ethers.id('m1') });
    await mission.authorizePayment(first, 0);

    const second = makeAuth({
      requestId: ethers.id('duplicate'),
      mandateHash: ethers.id('m2'),
      paymentNonce: 2n,
    });
    await expect(mission.authorizePayment(second, 1)).to.be.revertedWithCustomError(
      mission,
      'RequestAlreadyUsed'
    );
  });

  it('rejects a non-increasing payment nonce', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ paymentNonce: 0n }), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidNonce');
  });

  it('rejects a merchant outside the allowlist', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ merchantAddress: other.address }), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidMerchant');
  });

  it('rejects the wrong payment token', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ tokenAddress: other.address }), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidToken');
  });

  it('rejects an amount above maxPaymentAtomic', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ amountAtomic: 401n }), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidAmount');
  });

  it('rejects an amount above the mission budget envelope', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ amountAtomic: 1_001n }), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidAmount');
  });

  it('rejects an invalid signature', async () => {
    await expect(
      mission.authorizePayment(makeAuth({ signer: successor }), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidSignature');
  });

  it('rejects a malformed signature', async () => {
    const auth = makeAuth();
    auth.agentSignature = '0x1234';
    await expect(mission.authorizePayment(auth, 0)).to.be.revertedWithCustomError(
      mission,
      'InvalidSignature'
    );
  });

  it('rejects a malleable high-s signature', async () => {
    const mandateHash = ethers.id('malleable');
    const signature = primary.signingKey.sign(mandateHash);
    const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const highS = curveOrder - BigInt(signature.s);
    const malleable = ethers.concat([
      signature.r,
      ethers.toBeHex(highS, 32),
      ethers.toBeHex(signature.v === 27 ? 28 : 27, 1),
    ]);

    const auth = makeAuth({ mandateHash });
    auth.agentSignature = malleable;
    await expect(mission.authorizePayment(auth, 0)).to.be.revertedWithCustomError(
      mission,
      'InvalidSignature'
    );
  });

  it('serializes concurrent authorizations through stateVersion', async () => {
    const first = makeAuth({ requestId: ethers.id('first'), mandateHash: ethers.id('m1') });
    await mission.authorizePayment(first, 0);

    const second = makeAuth({
      requestId: ethers.id('second'),
      mandateHash: ethers.id('m2'),
      paymentNonce: 2n,
    });
    await expect(mission.authorizePayment(second, 0)).to.be.revertedWithCustomError(
      mission,
      'InvalidVersion'
    );
  });

  it('lets the owner cancel and emits status/cancel events', async () => {
    await expect(mission.cancel(0))
      .to.emit(mission, 'MissionStatusChanged')
      .withArgs(MissionStatus.ACTIVE, MissionStatus.CANCELLED, 1n)
      .and.to.emit(mission, 'MissionCancelled')
      .withArgs(deployer.address, 1n);

    const authority = await mission.authority();
    expect(Number(authority.status)).to.equal(MissionStatus.CANCELLED);
    expect(authority.stateVersion).to.equal(1n);
  });

  it('rejects cancellation by a non-owner', async () => {
    await expect(mission.connect(other).cancel(0)).to.be.revertedWithCustomError(
      mission,
      'NotOwner'
    );
  });

  it('rejects cancellation with a stale version', async () => {
    await expect(mission.cancel(1)).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });

  it('rejects a second cancellation', async () => {
    await mission.cancel(0);
    await expect(mission.cancel(1)).to.be.revertedWithCustomError(mission, 'InvalidStatus');
  });

  it('rejects cancellation after expiry', async () => {
    const shortConfig = await baseConfig(primary.address, successor.address, merchant, token, {
      expiresAt: now + 10n,
    });
    const created = await createMission(factory, shortConfig);
    await ethers.provider.send('evm_increaseTime', [20]);
    await ethers.provider.send('evm_mine', []);

    await expect(created.mission.cancel(0)).to.be.revertedWithCustomError(
      created.mission,
      'InvalidExpiry'
    );
  });
});
