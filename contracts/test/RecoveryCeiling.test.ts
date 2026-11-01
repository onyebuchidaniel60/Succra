import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Contract, Wallet } from 'ethers';
import {
  MissionStatus,
  baseConfig,
  createMission,
  currentTimestamp,
  setAuthorityStatus,
  signMandate,
} from './helpers';

describe('SuccraMission recovery payment ceiling', () => {
  let factory: Contract;
  let mission: Contract;
  let primary: Wallet;
  let merchant: string;
  let token: string;
  let now: bigint;

  beforeEach(async () => {
    const [deployer] = await ethers.getSigners();
    const [, guardianSigner] = await ethers.getSigners();
    primary = ethers.Wallet.createRandom();
    merchant = ethers.Wallet.createRandom().address;
    token = ethers.Wallet.createRandom().address;
    now = await currentTimestamp();

    const Registry = await ethers.getContractFactory('GuardianRegistry');
    const registry = await Registry.deploy(guardianSigner.address);
    await registry.waitForDeployment();
    const Factory = await ethers.getContractFactory('MissionFactory');
    factory = await Factory.deploy(await registry.getAddress());
    await factory.waitForDeployment();

    const config = await baseConfig(
      primary.address,
      ethers.Wallet.createRandom().address,
      merchant,
      token,
      {
        budgetAtomic: 1000n,
        maxPaymentAtomic: 400n,
        recoveryMaxPaymentAtomic: 100n,
      }
    );
    const created = await createMission(factory, config, deployer);
    mission = created.mission;
  });

  function makeAuth(amountAtomic: bigint, nonce: bigint, label: string) {
    const mandateHash = ethers.id(`mandate-${label}`);
    return {
      requestId: ethers.id(`request-${label}`),
      agent: primary.address,
      merchant,
      token,
      amountAtomic,
      paymentNonce: nonce,
      expiresAt: now + 3_600n,
      mandateHash,
      agentSignature: signMandate(primary, mandateHash),
    };
  }

  it('accepts a recovery payment at the recovery ceiling', async () => {
    await setAuthorityStatus(mission, MissionStatus.ACTIVE_RECOVERY);
    await mission.authorizePayment(makeAuth(100n, 1n, 'exact'), 0);
    expect((await mission.authority()).agentNonce).to.equal(1n);
  });

  it('rejects a recovery payment above recoveryMaxPaymentAtomic', async () => {
    await setAuthorityStatus(mission, MissionStatus.ACTIVE_RECOVERY);
    await expect(
      mission.authorizePayment(makeAuth(101n, 1n, 'over'), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidAmount');
  });

  it('does not use maxPaymentAtomic as the recovery ceiling', async () => {
    await setAuthorityStatus(mission, MissionStatus.ACTIVE_RECOVERY);
    await expect(
      mission.authorizePayment(makeAuth(400n, 1n, 'max'), 0)
    ).to.be.revertedWithCustomError(mission, 'InvalidAmount');
  });

  it('still accepts maxPaymentAtomic while the mission is ACTIVE', async () => {
    await mission.authorizePayment(makeAuth(400n, 1n, 'active'), 0);
    expect((await mission.authority()).agentNonce).to.equal(1n);
  });
});
