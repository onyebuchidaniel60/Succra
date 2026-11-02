// Phase 6 migration integration: real PGlite schema for checkpoints/succession.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPhase6TestDb } from '../../apps/web/tests/helpers/pglite-gateway-store';

describe('Phase 6 succession migration', () => {
  let db: Awaited<ReturnType<typeof createPhase6TestDb>>;
  let ownerId: string;
  let missionId: string;
  let alphaId: string;
  let betaId: string;
  let gammaId: string;

  beforeAll(async () => {
    db = await createPhase6TestDb();
    ownerId = randomUUID();
    missionId = randomUUID();
    alphaId = randomUUID();
    betaId = randomUUID();
    gammaId = randomUUID();
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId]);
    await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
      ownerId,
      `0x${'11'.repeat(20)}`,
    ]);
    for (const [id, address] of [
      [alphaId, `0x${'22'.repeat(20)}`],
      [betaId, `0x${'33'.repeat(20)}`],
      [gammaId, `0x${'44'.repeat(20)}`],
    ] as const) {
      await db.query(
        `INSERT INTO agents (id, owner_id, name, address, public_key, status)
         VALUES ($1,$2,'agent',$3,$3,'REGISTERED')`,
        [id, ownerId, address]
      );
    }
    await db.query(
      `INSERT INTO missions
         (id, owner_id, name, objective, pda_address, vault_address, mint_address,
          budget_atomic, remaining_budget_atomic, status, current_agent_id,
          current_agent_public_key, policy_version, policy_hash, expires_at,
          contract_address, factory_address, owner_address, payment_token_address,
          current_agent_address)
       VALUES ($1,$2,'M','O',$3,$4,$5,'1000','1000','QUARANTINED',$6,
          $7,1,'hash',now() + interval '1 hour',$3,$8,$9,$5,$7)`,
      [
        missionId,
        ownerId,
        `0x${'55'.repeat(20)}`,
        `vault-${missionId}`,
        `0x${'66'.repeat(20)}`,
        alphaId,
        `0x${'22'.repeat(20)}`,
        `0x${'77'.repeat(20)}`,
        `0x${'11'.repeat(20)}`,
      ]
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('creates mission_checkpoints with the documented columns and unique sequence', async () => {
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'mission_checkpoints'`
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const column of [
      'id',
      'mission_id',
      'sequence',
      'status',
      'checkpoint_hash',
      'confirmed_payment_ids',
      'confirmed_transaction_hashes',
      'hsp_mandate_ids',
      'confirmed_spent_atomic',
      'policy_version',
      'policy_hash',
      'committed_tx_hash',
      'created_at',
    ]) {
      expect(names.has(column)).toEqual(true);
    }
    const insert = (id: string) =>
      db.query(
        `INSERT INTO mission_checkpoints
           (id, mission_id, sequence, status, checkpoint_hash, confirmed_spent_atomic,
            policy_version, policy_hash)
         VALUES ($1,$2,0,'VERIFIED','hash',0,1,'policy')`,
        [id, missionId]
      );
    await insert(randomUUID());
    await expect(insert(randomUUID())).rejects.toBeDefined();
  });

  it('creates succession_events with nullable pre-confirmation activation hash', async () => {
    const columns = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'succession_events'`
    );
    const byName = new Map(columns.rows.map((row) => [row.column_name, row.is_nullable]));
    expect(byName.get('activation_tx_hash')).toEqual('YES');
    expect(byName.get('acknowledgement_tx_hash')).toEqual('YES');

    await db.query(
      `INSERT INTO succession_events
         (mission_id, from_agent_id, from_agent_address, to_agent_id, to_agent_address,
          trigger_type, recovery_max_payment_atomic, status, activation_tx_hash)
       VALUES ($1,$2,$3,$4,$5,'quarantine',100,'PENDING_ACK',NULL)`,
      [missionId, alphaId, `0x${'22'.repeat(20)}`, betaId, `0x${'33'.repeat(20)}`]
    );
    await expect(
      db.query(
        `INSERT INTO succession_events
           (mission_id, from_agent_id, from_agent_address, to_agent_id, to_agent_address,
            trigger_type, recovery_max_payment_atomic, status, activation_tx_hash)
         VALUES ($1,$2,$3,$4,$5,'quarantine',100,'PENDING_ACK',$6)`,
        [
          missionId,
          alphaId,
          `0x${'22'.repeat(20)}`,
          gammaId,
          `0x${'44'.repeat(20)}`,
          `0x${'88'.repeat(32)}`,
        ]
      )
    ).rejects.toBeDefined();
    await expect(
      db.query(
        `INSERT INTO succession_events
           (mission_id, from_agent_id, from_agent_address, to_agent_id, to_agent_address,
            trigger_type, recovery_max_payment_atomic, status, activation_tx_hash)
         VALUES ($1,$2,$3,$4,$5,'quarantine',100,'ACKNOWLEDGED',NULL)`,
        [missionId, alphaId, `0x${'22'.repeat(20)}`, gammaId, `0x${'44'.repeat(20)}`]
      )
    ).rejects.toThrow(/succession_events_activation_tx_check/);
  });

  it('keeps both Phase 6 tables owner-select/service-role-write', async () => {
    const policies = await db.query<{ tablename: string; cmd: string }>(
      `SELECT tablename, cmd FROM pg_policies
       WHERE tablename IN ('mission_checkpoints','succession_events') ORDER BY tablename`
    );
    expect(policies.rows.map((row) => `${row.tablename}:${row.cmd}`).sort()).toEqual([
      'mission_checkpoints:SELECT',
      'succession_events:SELECT',
    ]);
  });
});
