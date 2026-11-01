import { ethers } from 'hardhat';
import type { Contract, Signer } from 'ethers';

export const MissionStatus = {
  DRAFT: 0,
  ACTIVE: 1,
  DEGRADED: 2,
  QUARANTINED: 3,
  RECOVERING: 4,
  ACTIVE_RECOVERY: 5,
  COMPLETED: 6,
  CANCELLED: 7,
  EXPIRED: 8,
  HALTED: 9,
} as const;

export type SuccessorInput = {
  agent: string;
  priority: number;
  active: boolean;
};

export type MissionConfigInput = {
  paymentToken: string;
  budgetAtomic: bigint;
  maxPaymentAtomic: bigint;
  recoveryMaxPaymentAtomic: bigint;
  merchantAllowlist: string[];
  expiresAt: bigint;
  policyHash: string;
  primaryAgent: string;
  successors: SuccessorInput[];
  violationThreshold: number;
  violationWindowSeconds: bigint;
  cartMandateHash: string;
};

export async function deployRegistryAndFactory() {
  const [deployer, other] = await ethers.getSigners();
  const guardian = ethers.Wallet.createRandom();
  const Registry = await ethers.getContractFactory('GuardianRegistry');
  const registry = await Registry.deploy(guardian.address);
  await registry.waitForDeployment();

  const Factory = await ethers.getContractFactory('MissionFactory');
  const factory = await Factory.deploy(await registry.getAddress());
  await factory.waitForDeployment();

  return { deployer, other, guardian, registry, factory };
}

export async function currentTimestamp(): Promise<bigint> {
  const block = await ethers.provider.getBlock('latest');
  if (!block) throw new Error('no latest block');
  return BigInt(block.timestamp);
}

export async function baseConfig(
  primaryAgent: string,
  successorAgent: string,
  merchant: string,
  token: string,
  overrides: Partial<MissionConfigInput> = {}
): Promise<MissionConfigInput> {
  const now = await currentTimestamp();
  return {
    paymentToken: token,
    budgetAtomic: 1000n,
    maxPaymentAtomic: 400n,
    recoveryMaxPaymentAtomic: 100n,
    merchantAllowlist: [merchant],
    expiresAt: now + 86_400n,
    policyHash: ethers.id('policy'),
    primaryAgent,
    successors: [{ agent: successorAgent, priority: 1, active: true }],
    violationThreshold: 3,
    violationWindowSeconds: 900n,
    cartMandateHash: ethers.id('cart-mandate'),
    ...overrides,
  };
}

export async function createMission(
  factory: Contract,
  config: MissionConfigInput,
  signer?: Signer
): Promise<{ mission: Contract; missionAddress: string }> {
  const connected = signer ? factory.connect(signer) : factory;
  const tx = await connected.createMission(config);
  await tx.wait();
  const total = await factory.totalMissions();
  const missionAddress = await factory.getMissionAt(total - 1n);
  const mission = await ethers.getContractAt('SuccraMission', missionAddress);
  return { mission, missionAddress };
}

export function signMandate(wallet: ethers.Wallet, mandateHash: string): string {
  return wallet.signingKey.sign(mandateHash).serialized;
}
