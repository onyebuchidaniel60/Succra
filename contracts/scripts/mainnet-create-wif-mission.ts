import { ethers } from 'hardhat';

const WIF = process.env.SUCCRA_WIF_ADDRESS ?? '0x5173b8eA6923c2d40267890D45C46a3480954773';
const FACTORY = process.env.SUCCRA_MISSION_FACTORY_ADDRESS ?? '0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917';
const MERCHANT = process.env.SUCCRA_DEMO_MERCHANT ?? '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
const PRIMARY = process.env.SUCCRA_DEMO_PRIMARY ?? '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const SUCCESSOR = process.env.SUCCRA_DEMO_SUCCESSOR ?? '0x90F79bf6EB2c4f870365E785982E1f101E93b906';

const TYPES = {
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
  const factory = await ethers.getContractAt('MissionFactory', FACTORY);
  const token = new ethers.Contract(
    WIF,
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
  const deposit = 10n ** 18n;
  const payment = 10n ** 16n; // 0.01 WIF
  const config = {
    paymentToken: WIF,
    budgetAtomic: 10n * 10n ** 18n,
    initialDepositAtomic: deposit,
    maxPaymentAtomic: 10n ** 18n,
    recoveryMaxPaymentAtomic: 5n * 10n ** 17n,
    merchantAllowlist: [MERCHANT],
    expiresAt: now + 7n * 24n * 60n * 60n,
    policyHash: ethers.id(`wif-policy-${Date.now()}`),
    primaryAgent: PRIMARY,
    successors: [{ agent: SUCCESSOR, priority: 1, active: true }],
    violationThreshold: 3,
    violationWindowSeconds: 900n,
    cartMandateHash: ethers.id(`wif-offer-${Date.now()}`),
  };

  const createTx = await factory.createMission(config);
  const createReceipt = await createTx.wait();
  const count = await factory.totalMissions();
  const missionAddress = await factory.getMissionAt(count - 1n);
  const mission = await ethers.getContractAt('SuccraMission', missionAddress);
  console.log(`createMissionTx=${createReceipt?.hash}`);
  console.log(`wifMission=${missionAddress}`);
  console.log(`sessionKey=${session.address}`);

  await (await mission.registerSessionKey(session.address, 0)).wait();
  await (await token.approve(missionAddress, deposit)).wait();
  await (await mission.deposit(deposit)).wait();
  console.log('deposit=1 WIF');

  const validBefore = now + 3_600n;
  const nonce = ethers.id(`wif-erc1271-${Date.now()}`);
  const domain = { name: 'World is Flat', version: '1', chainId: 4663, verifyingContract: WIF };
  const message = { from: missionAddress, to: MERCHANT, value: payment, validAfter: 0n, validBefore, nonce };
  const digest = ethers.TypedDataEncoder.hash(domain, TYPES, message);
  const signature = session.signingKey.sign(digest).serialized;
  await (await mission.approvePayment(digest, payment, MERCHANT, 1)).wait();

  try {
    const tx = await token.transferWithAuthorization(
      missionAddress,
      MERCHANT,
      payment,
      0n,
      validBefore,
      nonce,
      signature
    );
    const receipt = await tx.wait();
    console.log(`WIF_PASS transferTx=${receipt?.hash}`);
    console.log(`authorizationState=${await token.authorizationState(missionAddress, nonce)}`);
    await (
      await mission.recordSettlement(digest, payment, ethers.id(receipt?.hash ?? 'missing'), 2)
    ).wait();
  } catch (error) {
    const candidate = error as { shortMessage?: string; message?: string; receipt?: { hash?: string } };
    console.log(`WIF_FAIL reason=${candidate.shortMessage ?? candidate.message}`);
    console.log(`WIF_FAIL tx=${candidate.receipt?.hash ?? 'unavailable'}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
