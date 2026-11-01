import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createPhase4AgentDb, PGliteAgentStore } from './pglite-agent-store';

export interface AgentWorld {
  db: PGlite;
  store: PGliteAgentStore;
  ownerId: string;
  missionId: string;
  missionAddress: string;
  tokenAddress: string;
}

export async function seedAgentWorld(): Promise<AgentWorld> {
  const db = await createPhase4AgentDb();
  const store = new PGliteAgentStore(db);
  const ownerId = randomUUID();
  const missionId = randomUUID();
  const missionAddress = `0x${randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40)}`;
  const tokenAddress = `0x${randomUUID().replace(/-/g, '').padEnd(40, '1').slice(0, 40)}`;
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId]);
  await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
    ownerId,
    `0x${'aa'.repeat(20)}`,
  ]);
  await db.query(
    `INSERT INTO missions
       (id, owner_id, name, objective, pda_address, vault_address, mint_address,
        budget_atomic, remaining_budget_atomic, status, current_agent_public_key,
        policy_version, policy_hash, expires_at, contract_address, factory_address,
        owner_address, payment_token_address, current_agent_address)
     VALUES ($1,$2,'Agents','Register agents',$3,$4,$5,'1000','1000','ACTIVE',$6,1,'hash',
        now() + interval '1 hour',$3,$7,$8,$5,$6)`,
    [
      missionId,
      ownerId,
      missionAddress,
      `vault-${missionId}`,
      tokenAddress,
      `0x${'bb'.repeat(20)}`,
      `0x${'cc'.repeat(20)}`,
      `0x${'aa'.repeat(20)}`,
    ]
  );
  return { db, store, ownerId, missionId, missionAddress, tokenAddress };
}
