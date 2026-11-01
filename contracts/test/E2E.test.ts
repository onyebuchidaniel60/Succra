import { expect } from 'chai';
import { ethers } from 'hardhat';
import { baseConfig, createMission, currentTimestamp, signMandate } from './helpers';

/**
 * End-to-end contract proof:
 *   Phase 2 mandate digest -> agent EOA signature -> Phase 1 authorizePayment
 *   -> Phase 3 recordSettlement.
 *
 * The digest is computed with ethers' standard EIP-712 encoder. Phase 2's
 * hashPaymentMandate() is proven equal to viem's hashTypedData() in
 * apps/web/tests/hsp-mandate-viem.test.ts; both are canonical EIP-712. This
 * test proves the on-chain contract accepts that exact digest and signature.
 */
describe('E2E: Phase 2 digest accepted by SuccraMission', () => {
  const PAYMENT_MANDATE_TYPES = {
    PaymentMandate: [
      { name: 'cartMandateHash', type: 'bytes32' },
      { name: 'onchainRequestId', type: 'bytes32' },
      { name: 'missionAddress', type: 'address' },
      { name: 'agent', type: 'address' },
      { name: 'merchant', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amountAtomic', type: 'uint256' },
      { name: 'paymentNonce', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
    ],
  } as const;

  it('authorizes a signed mandate digest and records its settlement', async () => {
    const [deployer, guardian, runtime] = await ethers.getSigners();
    const agent = ethers.Wallet.createRandom();
    const merchant = ethers.Wallet.createRandom().address;
    const token = ethers.Wallet.createRandom().address;
    const now = await currentTimestamp();

    const Registry = await ethers.getContractFactory('GuardianRegistry');
    const registry = await Registry.deploy(guardian.address);
    await registry.waitForDeployment();
    const Factory = await ethers.getContractFactory('MissionFactory');
    const factory = await Factory.deploy(await registry.getAddress());
    await factory.waitForDeployment();

    const config = await baseConfig(
      agent.address,
      ethers.Wallet.createRandom().address,
      merchant,
      token,
      { budgetAtomic: 1000n, maxPaymentAtomic: 400n, recoveryMaxPaymentAtomic: 100n }
    );
    const { mission, missionAddress } = await createMission(factory, config, deployer);

    const requestIdString = 'e2e-request-1';
    const onchainRequestId = ethers.id(requestIdString);
    const cartMandateHash = `0x${'55'.repeat(32)}`;
    const amountAtomic = 100n;
    const paymentNonce = 1n;
    const expiresAt = now + 3_600n;

    const domain = {
      name: 'Succra',
      version: '1',
      chainId: 177,
      verifyingContract: missionAddress,
    };
    const message = {
      cartMandateHash,
      onchainRequestId,
      missionAddress,
      agent: agent.address,
      merchant,
      token,
      amountAtomic,
      paymentNonce,
      expiresAt,
    };
    const digest = ethers.TypedDataEncoder.hash(domain, PAYMENT_MANDATE_TYPES, message);
    const signature = agent.signingKey.sign(digest).serialized;

    // Off-chain sanity: the digest recovers to the agent EOA.
    expect(ethers.recoverAddress(digest, signature)).to.equal(agent.address);

    const auth = {
      requestId: onchainRequestId,
      agent: agent.address,
      merchant,
      token,
      amountAtomic,
      paymentNonce,
      expiresAt,
      mandateHash: digest,
      agentSignature: signature,
    };

    await expect(mission.connect(runtime).authorizePayment(auth, 0)).to.emit(
      mission,
      'PaymentAuthorized'
    );

    let authority = await mission.authority();
    expect(authority.stateVersion).to.equal(1n);
    expect(authority.agentNonce).to.equal(1n);
    expect(await mission.authorizedRequests(onchainRequestId)).to.equal(true);
    expect(await mission.authorizedAmount(onchainRequestId)).to.equal(amountAtomic);

    const settlementTxHash = ethers.id('e2e-settlement-tx');
    await expect(
      mission
        .connect(guardian)
        .recordSettlement(onchainRequestId, amountAtomic, settlementTxHash, 1)
    )
      .to.emit(mission, 'PaymentSettlementRecorded')
      .withArgs(onchainRequestId, amountAtomic, settlementTxHash);

    authority = await mission.authority();
    expect(authority.confirmedSpentAtomic).to.equal(amountAtomic);
    expect(authority.stateVersion).to.equal(2n);
    expect(await mission.recordedSettlements(onchainRequestId)).to.equal(true);

    // The digest is exactly the one the agent signed; the contract recovered
    // the registered agent address, not the runtime or guardian.
    expect(await mission.usedRequestIds(onchainRequestId)).to.equal(true);
  });

  it('keeps the guardian-only settlement rule in the E2E path', async () => {
    const [deployer, guardian, runtime] = await ethers.getSigners();
    const agent = ethers.Wallet.createRandom();
    const merchant = ethers.Wallet.createRandom().address;
    const token = ethers.Wallet.createRandom().address;
    const now = await currentTimestamp();

    const Registry = await ethers.getContractFactory('GuardianRegistry');
    const registry = await Registry.deploy(guardian.address);
    await registry.waitForDeployment();
    const Factory = await ethers.getContractFactory('MissionFactory');
    const factory = await Factory.deploy(await registry.getAddress());
    await factory.waitForDeployment();

    const config = await baseConfig(
      agent.address,
      ethers.Wallet.createRandom().address,
      merchant,
      token
    );
    const { mission } = await createMission(factory, config, deployer);
    const mandateHash = ethers.id('e2e-guardian-rule');
    const auth = {
      requestId: ethers.id('e2e-guardian-rule-request'),
      agent: agent.address,
      merchant,
      token,
      amountAtomic: 100n,
      paymentNonce: 1n,
      expiresAt: now + 3_600n,
      mandateHash,
      agentSignature: signMandate(agent, mandateHash),
    };
    await mission.connect(runtime).authorizePayment(auth, 0);

    await expect(
      mission.connect(runtime).recordSettlement(auth.requestId, 100n, ethers.id('tx'), 1)
    ).to.be.revertedWithCustomError(mission, 'NotGuardian');
  });
});
