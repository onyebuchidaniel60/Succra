import { ethers } from 'hardhat';

const WIF = process.env.SUCCRA_WIF_ADDRESS ?? '0x5173b8eA6923c2d40267890D45C46a3480954773';
const REGISTRY =
  process.env.SUCCRA_GUARDIAN_REGISTRY ?? '0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B';
const MERCHANT = process.env.SUCCRA_DEMO_MERCHANT ?? '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
const PRIMARY = process.env.SUCCRA_DEMO_PRIMARY ?? '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const SUCCESSOR = process.env.SUCCRA_DEMO_SUCCESSOR ?? '0x90F79bf6EB2c4f870365E785982E1f101E93b906';

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No mainnet deployer signer configured.');
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer=${deployer.address}`);
  console.log(`balanceWei=${balance}`);

  const block = await ethers.provider.getBlock('latest');
  const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));
  const deposit = 10n ** 18n; // 1 WIF
  const config = {
    paymentToken: WIF,
    budgetAtomic: 10n * 10n ** 18n,
    initialDepositAtomic: deposit,
    maxPaymentAtomic: 10n ** 17n, // 0.1 WIF
    recoveryMaxPaymentAtomic: 5n * 10n ** 16n, // 0.05 WIF
    merchantAllowlist: [MERCHANT],
    expiresAt: now + 30n * 24n * 60n * 60n,
    policyHash: ethers.id(`wif-treasury-policy-${Date.now()}`),
    primaryAgent: PRIMARY,
    successors: [{ agent: SUCCESSOR, priority: 1, active: true }],
    violationThreshold: 3,
    violationWindowSeconds: 900n,
    cartMandateHash: ethers.id(`wif-treasury-offer-${Date.now()}`),
  };

  const Mission = await ethers.getContractFactory('SuccraMission');
  const mission = await Mission.deploy(deployer.address, config, REGISTRY);
  await mission.waitForDeployment();
  const missionAddress = await mission.getAddress();
  console.log(`wifTreasuryMission=${missionAddress}`);
  console.log(`deployTx=${mission.deploymentTransaction()?.hash}`);

  const token = new ethers.Contract(
    WIF,
    ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'],
    deployer
  );
  await (await token.approve(missionAddress, deposit)).wait();
  await (await mission.deposit(deposit)).wait();
  console.log(`deposit=${deposit.toString()} atomic WIF`);
  console.log('wif-treasury-deployment=complete');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
