import { ethers } from 'hardhat';

const USDG = process.env.SUCCRA_USDG_ADDRESS ?? '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const FACTORY = process.env.SUCCRA_MISSION_FACTORY_ADDRESS ?? '0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917';
const MERCHANT = process.env.SUCCRA_DEMO_MERCHANT ?? '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
const PRIMARY = process.env.SUCCRA_DEMO_PRIMARY ?? '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const SUCCESSOR = process.env.SUCCRA_DEMO_SUCCESSOR ?? '0x90F79bf6EB2c4f870365E785982E1f101E93b906';

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No mainnet deployer signer configured.');
  const factory = await ethers.getContractAt('MissionFactory', FACTORY);
  const usdg = new ethers.Contract(
    USDG,
    [
      'function approve(address,uint256) returns (bool)',
      'function balanceOf(address) view returns (uint256)',
      'function authorizationState(address,bytes32) view returns (bool)',
      'function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
    ],
    deployer
  );

  const session = ethers.Wallet.createRandom();
  const now = BigInt((await ethers.provider.getBlock('latest'))!.timestamp);
  const initialDeposit = 1_000_000n; // 1 USDG
  const payment = 10_000n; // 0.01 USDG
  const config = {
    paymentToken: USDG,
    budgetAtomic: 10_000_000n,
    initialDepositAtomic: initialDeposit,
    maxPaymentAtomic: 1_000_000n,
    recoveryMaxPaymentAtomic: 500_000n,
    merchantAllowlist: [MERCHANT],
    expiresAt: now + 7n * 24n * 60n * 60n,
    policyHash: ethers.id(`mainnet-probe-policy-${Date.now()}`),
    primaryAgent: PRIMARY,
    successors: [{ agent: SUCCESSOR, priority: 1, active: true }],
    violationThreshold: 3,
    violationWindowSeconds: 900n,
    cartMandateHash: ethers.id(`mainnet-x402-offer-${Date.now()}`),
  };

  console.log(`deployer=${deployer.address}`);
  console.log(`factory=${FACTORY}`);
  console.log(`usdg=${USDG}`);
  console.log(`sessionKey=${session.address}`);

  const createTx = await factory.createMission(config);
  const createReceipt = await createTx.wait();
  const count = await factory.totalMissions();
  const missionAddress = await factory.getMissionAt(count - 1n);
  console.log(`createMissionTx=${createReceipt?.hash}`);
  console.log(`mission=${missionAddress}`);

  const mission = await ethers.getContractAt('SuccraMission', missionAddress);
  const registerTx = await mission.registerSessionKey(session.address, 0);
  await registerTx.wait();
  console.log(`registerSessionKeyTx=${registerTx.hash}`);

  const approveTx = await usdg.approve(missionAddress, initialDeposit);
  await approveTx.wait();
  const depositTx = await mission.deposit(initialDeposit);
  await depositTx.wait();
  console.log(`depositTx=${depositTx.hash}`);

  const validBefore = now + 3_600n;
  const nonce = ethers.id(`mainnet-erc1271-${Date.now()}`);
  const message = {
    from: missionAddress,
    to: MERCHANT,
    value: payment,
    validAfter: 0n,
    validBefore,
    nonce,
  };
  const domain = {
    name: 'Global Dollar',
    version: '1',
    chainId: 4663,
    verifyingContract: USDG,
  };
  const digest = ethers.TypedDataEncoder.hash(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, message);
  const signature = session.signingKey.sign(digest).serialized;
  const approvePaymentTx = await mission.approvePayment(digest, payment, MERCHANT, 1);
  await approvePaymentTx.wait();
  console.log(`approvePaymentTx=${approvePaymentTx.hash}`);
  console.log(`authorizationHash=${digest}`);

  try {
    const transferTx = await usdg.transferWithAuthorization(
      missionAddress,
      MERCHANT,
      payment,
      0n,
      validBefore,
      nonce,
      signature
    );
    const receipt = await transferTx.wait();
    console.log(`PASS transferTx=${receipt?.hash}`);
    console.log(`gasUsed=${receipt?.gasUsed}`);
    console.log(`authorizationState=${await usdg.authorizationState(missionAddress, nonce)}`);

    const settlement = await mission.recordSettlement(
      digest,
      payment,
      ethers.id(receipt?.hash ?? 'missing'),
      2
    );
    const settlementReceipt = await settlement.wait();
    console.log(`recordSettlementTx=${settlementReceipt?.hash}`);
  } catch (error) {
    const candidate = error as {
      shortMessage?: string;
      message?: string;
      receipt?: { hash?: string; gasUsed?: bigint };
    };
    console.log(`FAIL reason=${candidate.shortMessage ?? candidate.message}`);
    console.log(`FAIL tx=${candidate.receipt?.hash ?? 'unavailable'}`);
    console.log(`FAIL gasUsed=${candidate.receipt?.gasUsed?.toString() ?? 'unavailable'}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
