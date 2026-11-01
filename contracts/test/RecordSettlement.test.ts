import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import {
  baseConfig,
  createMission,
  currentTimestamp,
  signMandate,
  type MissionConfigInput,
} from './helpers';

describe('SuccraMission.recordSettlement', () => {
  let factory: Contract;
  let registry: Contract;
  let mission: Contract;
  let guardian: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let primary: Wallet;
  let merchant: string;
  let token: string;
  let now: bigint;

  beforeEach(async () => {
    const [deployer, guardianSigner, otherSigner] = await ethers.getSigners();
    guardian = guardianSigner;
    other = otherSigner;
    primary = ethers.Wallet.createRandom();
    merchant = ethers.Wallet.createRandom().address;
    token = ethers.Wallet.createRandom().address;
    now = await currentTimestamp();

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
      token,
      { budgetAtomic: 1000n, maxPaymentAtomic: 1000n, recoveryMaxPaymentAtomic: 100n }
    );
    const created = await createMission(factory, config, deployer);
    mission = created.mission;
  });

  function makeAuth(overrides: Partial<Record<string, unknown>> = {}) {
    const mandateHash = (overrides['mandateHash'] as string | undefined) ?? ethers.id('mandate-1');
    const signer = (overrides['signer'] as Wallet | undefined) ?? primary;
    return {
      requestId: (overrides['requestId'] as string | undefined) ?? ethers.id('request-1'),
      agent: (overrides['agent'] as string | undefined) ?? primary.address,
      merchant: (overrides['merchant'] as string | undefined) ?? merchant,
      token: (overrides['token'] as string | undefined) ?? token,
      amountAtomic: (overrides['amountAtomic'] as bigint | undefined) ?? 100n,
      paymentNonce: (overrides['paymentNonce'] as bigint | undefined) ?? 1n,
      expiresAt: (overrides['expiresAt'] as bigint | undefined) ?? now + 3_600n,
      mandateHash,
      agentSignature: signMandate(signer, mandateHash),
    };
  }

  async function authorize(overrides: Partial<Record<string, unknown>> = {}) {
    const auth = makeAuth(overrides);
    const version = (await mission.authority()).stateVersion as bigint;
    await mission.authorizePayment(auth, version);
    return auth;
  }

  it('rejects a settlement for an unauthorized payment id', async () => {
    await expect(
      mission
        .connect(guardian)
        .recordSettlement(ethers.id('never-authorized'), 100n, ethers.id('tx'), 0)
    ).to.be.revertedWithCustomError(mission, 'NotAuthorized');
  });

  it('rejects a mismatched amount', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    await expect(
      mission.connect(guardian).recordSettlement(auth.requestId, 99n, ethers.id('tx'), 1)
    ).to.be.revertedWithCustomError(mission, 'AmountMismatch');
  });

  it('rejects a caller that is not the guardian', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    await expect(
      mission.connect(other).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1)
    ).to.be.revertedWithCustomError(mission, 'NotGuardian');
  });

  it('uses the live GuardianRegistry guardian after rotation', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    await registry.rotateGuardian(other.address);
    await expect(
      mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1)
    ).to.be.revertedWithCustomError(mission, 'NotGuardian');
    await expect(
      mission.connect(other).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1)
    ).to.emit(mission, 'PaymentSettlementRecorded');
  });

  it('records an authorized settlement and emits PaymentSettlementRecorded', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    const txHash = ethers.id('settlement-tx');
    await expect(mission.connect(guardian).recordSettlement(auth.requestId, 100n, txHash, 1))
      .to.emit(mission, 'PaymentSettlementRecorded')
      .withArgs(auth.requestId, 100n, txHash);
    expect(await mission.recordedSettlements(auth.requestId)).to.equal(true);
  });

  it('increments confirmedSpentAtomic', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    await mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1);
    expect((await mission.authority()).confirmedSpentAtomic).to.equal(100n);
  });

  it('advances stateVersion', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    expect((await mission.authority()).stateVersion).to.equal(1n);
    await mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1);
    expect((await mission.authority()).stateVersion).to.equal(2n);
  });

  it('rejects a duplicate payment id', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    await mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1);
    await expect(
      mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx-2'), 2)
    ).to.be.revertedWithCustomError(mission, 'AlreadyRecorded');
  });

  it('rejects a settlement that would exceed the budget (defense in depth)', async () => {
    // Authorize both before either settlement is recorded: each fits the
    // per-payment cap and the budget at authorization time, but the second
    // settlement would push confirmed spend past the budget.
    const first = await authorize({ requestId: ethers.id('request-1'), amountAtomic: 900n });
    const second = await authorize({
      requestId: ethers.id('request-2'),
      amountAtomic: 200n,
      paymentNonce: 2n,
    });
    await mission.connect(guardian).recordSettlement(first.requestId, 900n, ethers.id('tx-1'), 2);
    await expect(
      mission.connect(guardian).recordSettlement(second.requestId, 200n, ethers.id('tx-2'), 3)
    ).to.be.revertedWithCustomError(mission, 'InvalidAmount');
  });

  it('rejects a stale expected version', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    await expect(
      mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidVersion');
  });

  it('keeps authorizedRequests and authorizedAmount keyed by request id', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    expect(await mission.authorizedRequests(auth.requestId)).to.equal(true);
    expect(await mission.authorizedAmount(auth.requestId)).to.equal(100n);
  });

  it('does not record the same payment twice even if the payment was authorized once', async () => {
    const auth = await authorize({ amountAtomic: 100n });
    await mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1);
    const before = (await mission.authority()).confirmedSpentAtomic;
    await expect(
      mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx-2'), 2)
    ).to.be.revertedWithCustomError(mission, 'AlreadyRecorded');
    expect((await mission.authority()).confirmedSpentAtomic).to.equal(before);
  });

  it('resets violationCount to zero after a confirmed settlement', async () => {
    await mission.connect(guardian).recordViolation(ethers.id('violation-1'), 0);
    await mission.connect(guardian).recordViolation(ethers.id('violation-2'), 1);
    expect((await mission.authority()).violationCount).to.equal(2);

    const auth = await authorize({ amountAtomic: 100n });
    await mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 3);

    expect((await mission.authority()).violationCount).to.equal(0);
  });

  it('resets lastViolationAt to zero after a confirmed settlement', async () => {
    await mission.connect(guardian).recordViolation(ethers.id('violation-1'), 0);
    expect((await mission.authority()).lastViolationAt).to.be.greaterThan(0n);

    const auth = await authorize({ amountAtomic: 100n });
    await mission.connect(guardian).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 2);

    expect((await mission.authority()).lastViolationAt).to.equal(0n);
  });

  it('accepts a custom budget/max config without changing the guardian rule', async () => {
    const config: MissionConfigInput = await baseConfig(
      primary.address,
      ethers.Wallet.createRandom().address,
      merchant,
      token,
      { budgetAtomic: 500n, maxPaymentAtomic: 500n, recoveryMaxPaymentAtomic: 50n }
    );
    const [deployer] = await ethers.getSigners();
    const created = await createMission(factory, config, deployer);
    const auth = makeAuth({ amountAtomic: 500n });
    await created.mission.authorizePayment(auth, 0);
    await created.mission
      .connect(guardian)
      .recordSettlement(auth.requestId, 500n, ethers.id('tx'), 1);
    expect((await created.mission.authority()).confirmedSpentAtomic).to.equal(500n);
  });
});
