import { ethers } from 'hardhat';

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const WIF = '0x5173b8eA6923c2d40267890D45C46a3480954773';

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No mainnet deployer signer configured.');
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer=${deployer.address}`);
  console.log(`balanceWei=${balance}`);
  if (balance === 0n) throw new Error('Mainnet deployer has no ETH for gas.');

  const guardian = process.env.SUCCRA_GUARDIAN_ADDRESS ?? deployer.address;
  const Registry = await ethers.getContractFactory('GuardianRegistry');
  const registry = await Registry.deploy(guardian);
  await registry.waitForDeployment();
  console.log(`guardianRegistry=${await registry.getAddress()}`);

  const Factory = await ethers.getContractFactory('MissionFactory');
  const factory = await Factory.deploy(await registry.getAddress());
  await factory.waitForDeployment();
  console.log(`missionFactory=${await factory.getAddress()}`);

  const setTokens = await factory.setAllowedTokens([USDG, WIF]);
  await setTokens.wait();
  console.log('allowedTokens=USDG,WIF');

  console.log('deployment=complete');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
