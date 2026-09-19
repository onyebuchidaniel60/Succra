// Succra gateway — program PDA derivation (@solana/kit).
//
// Seeds mirror the program exactly (programs/succra/src/lib.rs +
// programs/succra/tests/succra.ts missionPdas):
// mission ["mission", owner(32), mission_id u64 LE],
// vault ["vault", mission(32)], spl-vault ["spl-vault", mission(32)],
// ATA [owner(32), token-program(32), mint(32)] under the associated
// token program.
import { address, getProgramDerivedAddress } from '@solana/kit';
import { ASSOCIATED_TOKEN_PROGRAM_ID, base58ToBytes32, TOKEN_PROGRAM_ID } from '@succra/shared';

function u64LeBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

export async function findMissionPda(
  programId: string,
  ownerAddress: string,
  missionId: bigint
): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      new TextEncoder().encode('mission'),
      base58ToBytes32(ownerAddress),
      u64LeBytes(missionId),
    ],
  });
  return String(pda);
}

export async function findVaultPda(programId: string, missionAddress: string): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [new TextEncoder().encode('vault'), base58ToBytes32(missionAddress)],
  });
  return String(pda);
}

export async function findSplVaultPda(programId: string, missionAddress: string): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [new TextEncoder().encode('spl-vault'), base58ToBytes32(missionAddress)],
  });
  return String(pda);
}

export async function findAssociatedTokenAddress(
  ownerAddress: string,
  mintAddress: string
): Promise<string> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM_ID),
    seeds: [
      base58ToBytes32(ownerAddress),
      base58ToBytes32(TOKEN_PROGRAM_ID),
      base58ToBytes32(mintAddress),
    ],
  });
  return String(ata);
}
