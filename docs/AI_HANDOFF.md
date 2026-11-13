# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on Robinhood Chain (EVM, x402).

## Frozen product statement
Succra allows an economic mission to survive primary-agent failure by maintaining mission authority outside the agent, quarantining unsafe authority, preserving verified mission state, activating a pre-approved successor, and granting constrained recovery authority.

## Final UX / WIF treasury checkpoint (2026-11-12, `9c4cc61`)

- **Editable deposits:** `/missions/new` accepts a user-entered amount, validates it in the browser and API at the selected token's decimals (6 for USDG, 18 for WIF), and deposits into the matching vault before redirecting to `/missions/<vault>`. Live verification used `0.02 USDG` and landed on the USDG mission detail.
- **WIF treasury path:** `SuccraMission.executeERC20Transfer(token,to,amount)` enforces configured token, merchant allowlist, per-payment ceiling, cumulative budget, and available balance. Policy failures increment the violation streak and emit `TreasuryTransferBlocked`; successful transfers emit `TreasuryTransfer` and reset the streak.
- **New WIF mission:** `0x5bdC628D1b0c7DE78579E076398f4c5216e10e08`, funded with 1 WIF, deployed with tx `0x74645d94a5619c4ff7d22d92834c8377ed757ee52f63ff4ed108ee2443d296ea`. The orchestrator routes `wif-payment` through `executeERC20Transfer`.
- **Live WIF proof:** `POST /api/demo?demo=true {"action":"wif-payment"}` settled 0.01 WIF to the allowlisted merchant: tx `0x4945743cc237cb65ca2e6ec7a5c120df6e8d3cdfdd6ad4b34ec6d3d9a4032014`.
- **Branding/footer:** the MIT-licensed Relay SVG is at `apps/web/public/logo.svg` and `apps/web/app/icon.svg`; headers and the shared footer use it. Footer columns cover Product, Resources, and Network with working links.
- **Branch policy:** only `main` remains. Tags `hashkey-v1` and `solana-v1` are preserved.
- **Tests:** contracts **115 passing**, `demo-auth` **5 passing**, workspace typecheck/lint/build pass.

## Current privacy / navigation checkpoint (2026-11-12, `d7ddc0e`)

- **Private dashboard is owner-scoped.** `/api/demo` returns an empty state when no owner is supplied or the owner is not the deployer. A bare `?owner=0x...` is not authorization.
- **Owner access requires a signed challenge.** `GET/POST /api/demo/auth` issues a five-minute message challenge and returns a 12-hour opaque bearer token after `personal_sign` verification. Private state and owner actions require that token.
- **Public simulation is explicit.** `/api/demo?demo=true` and `POST /api/demo?demo=true` remain public for the live demo; `/missions/demo` renders that view.
- **Dashboard flow:** `/dashboard` uses wagmi `useAccount`, shows the exact empty state for disconnected/zero-mission wallets, offers **New Mission** and **View Live Demo Mission**, and contains no simulator controls.
- **Mission detail flow:** `/missions/demo` is the only place with simulator controls. `/missions/[id]` adds **Back to Dashboard** and a **Connect Agent** snippet. Owner detail is scoped to the verified wallet.
- **Create flow:** `/missions/new` requires the owner wallet, unlocks with a signature, accepts a user-entered USDG or WIF deposit amount, routes `{ action: 'deposit', token, amount }` through the backend into the matching vault, then redirects to `/missions/<vault>`. Non-owner wallets get a clean owner-operated notice and a link to the public demo; multi-tenant factory creation is not enabled.
- **Verified on production (2026-11-12):** `/api/demo` → empty state; `?owner=<deployer>` → `401 OWNER_AUTH_REQUIRED`; `?demo=true` → two live missions and 18 events; incognito `/dashboard` → empty state. Vercel production build passed; Render service `srv-dbqv8cvf3r2c73cufumg` deployed commit `d7ddc0e`.
- **Tests:** `pnpm -r typecheck` pass, `pnpm --filter @succra/web build` pass, contracts **107 passing**, new `apps/web/tests/demo-auth.test.ts` **4 passing**. The legacy HashKey wallet-connect/mission-detail tests and PGlite creation tests remain stale/failing on this branch and are not part of the active Robinhood path.

## Current status
**Pivot notice (2026-11-03): Succra is pivoting from HashKey Chain (HSP) to Robinhood Chain (x402) for the World is Flat hackathon (submissions close 2026-11-12 17:30 UTC). The product thesis is unchanged: Succra is the continuity layer that keeps an economic mission alive when its autonomous agent fails. Agents can fail. Missions don't have to.**

- HashKey implementation archived at annotated tag `hashkey-v1` → `phase-7-ux` @ `cc0f90b` (Phase 7a/7b/7c complete; not merged to main). `main` is @ `549629d` (Phase 6 merge).
- **R0 complete (chain swap):** docs authorize Robinhood Chain / x402, mainnet 4663 and testnet 46630, USDG, and the x402 facilitator.
- **R0b complete @ `f98cafe`:** docs authorize the program-controlled vault model (Model A), session-key lifecycle, deposit/withdrawal, the R1-spike gate, and the mission-continuity reframe.
- Docs now specify:
  - `SuccraMission` holds mission USDG; the owner deposits at creation and can withdraw unilaterally at any status.
  - A session key is registered at mission creation, held server-side by the runtime, revoked on quarantine, and replaced on succession with the reduced recovery cap.
  - Two EIP-3009 variants: **A** (contract signer via ERC-1271) and **B** (session key funded on-demand); R1-spike decides.
  - The owner is never in the per-payment loop.
- Phase sequence: **R0** (archive + docs pivot; complete), **R0b** (Model A docs amendment; complete), **R1** (implementation; complete), **R2/R3** (mainnet deployment + live flow; complete), **R4** (live Vercel/Render video; complete).
- **R1 implementation complete:** vault, session-key lifecycle, Variant A `approvePayment` + ERC-1271 `isValidSignature`, Variant B `releaseForPayment`, USDG/WIF factory allowlist, x402 client, premium UI, and mainnet orchestrator. Contract suite: **107 passing**.
- **Mainnet deployment complete:** GuardianRegistry `0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B`; MissionFactory `0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917`; USDG mission `0x37522496E38f7859C96bCAC058d23f7296BB646b`; WIF treasury mission `0x5bdC628D1b0c7DE78579E076398f4c5216e10e08` (new `executeERC20Transfer` bytecode).
- **Real Paxos USDG ERC-1271 probe: PASS.** `transferWithAuthorization` with `from=mission` succeeded, `authorizationState=true`, tx `0x7024fd4153b3d378952118002122ea9861ded8998bac032d5eaeae0de0cea3a8`. Variant A is live.
- **Live mainnet continuity flow complete:** x402 payment, three violations, quarantine, owner withdrawal, successor activation, recovery payment. Evidence is in `demo-video/mainnet-state.json` and linked from the live UI.
- **WIF finding:** the real WIF token is a plain ERC-20 with no `transferWithAuthorization` or `isValidSignature` selectors, so WIF cannot settle through x402. The new WIF treasury mission `0x5bdC628D1b0c7DE78579E076398f4c5216e10e08` implements `executeERC20Transfer` with token/merchant allowlists, per-payment ceilings, budget checks, and on-chain violation recording. The old vault-only mission `0x84Dab…` remains historical evidence.
- **Deployment:** frontend https://succra.vercel.app; backend https://succra-backend.onrender.com; Neon Postgres via `DATABASE_URL`; Render `render.yaml`.
- **R4 complete:** `demo-video/succra_demo.mp4` (1920×1080, 88.3s), recorded against the live Vercel UI, with ElevenLabs voiceover, royalty-free music, and mainnet Blockscout hashes. Submission text: `SUBMISSION.md`.
- **Next assigned task: hackathon submission and optional WIF wrapper / EIP-3009-compatible WIF deployment.**

## Historical HashKey delivery (archived at `hashkey-v1`)

Phase 1 delivery (merged @ `fbce1c2`):
- `GuardianRegistry` with global guardian and owner-only rotation;
- `MissionFactory` deploys missions directly to `ACTIVE` and indexes by owner;
- `SuccraMission` with policy enforcement, `authorizePayment`, `cancel`, and state-version guards;
- 36 contract tests passing; `contracts` CI job required.

Phase 2 delivery (merged @ `40abe03`):
- migration `20261101000000_phase2_preflight.sql` extends `action_requests` with request/on-chain/mandate fields and tightens RLS to owner SELECT + service-role writes;
- `agent_request_nonces` remains service-role only;
- `packages/shared` adds the EIP-712 domain, `SuccraRequest` typed data, canonical body hash, method/path hash, and request-id binding;
- `packages/hsp-client` adds PROVISIONAL HSP Cart/Payment Mandate types, HMAC-SHA256, ES256K JWT, deterministic mandate hashing, and a test-only mock server;
- JWT uses `@noble/curves` secp256k1 + SHA-256 because Node WebCrypto does not support secp256k1; the signature is compact r||s and verified against the same digest viem produces;
- `apps/web` adds the HSP policy evaluator, agent EIP-712 auth middleware, viem contract reader, preflight store, and `POST /api/missions/:id/actions` preflight endpoint;
- preflight constructs the unsigned mandate locally and never calls HSP; submission/settlement remains Phase 3;
- contract-reader uses `getMerchantAllowlist()` plus the on-chain config, so no contract change was needed;
- Phase 1 review notes folded in: AI_HANDOFF correction, running-budget TODO, and `contracts/README.md` test-config note;
- tests: **223 passing** workspace-wide (61 new Phase 2 tests), 2 skipped live tests; 36 contract tests still pass.

`cartMandateId` is provisionally the mission UUID until HSP merchant access exists. The HSP typed-data schema remains PROVISIONAL and must be reconciled in Phase 9. Solana dead-code residue remains in `apps/web`, `packages/*`, `supabase/`, and `tests/`; it will be replaced through Phase 7.

Open questions:
- HSP merchant access: sandbox vs mock.
- HashKey mainnet deployer wallet funding.
- Demo recording plan: testnet + mock vs live mainnet.
- `@tanstack/react-query` is now installed for Phase 7a wallet/query UI.

Phase 3 delivery (merged @ `4bb1641`):
- mission schema migrated to HashKey columns (`contract_address`, `factory_address`, `owner_address`, `payment_token_address`, `current_agent_address`), with legacy Solana columns retained until Phase 7;
- `hsp_payments` and `hsp_webhook_events` tables added; owner SELECT / service-role writes;
- `SuccraMission.recordSettlement` added as guardian-only, guarded by `authorizedRequests`, `authorizedAmount`, and `recordedSettlements`;
- submit endpoint now authorizes on-chain via the runtime signer, submits to the mock HSP, waits for settlement, records settlement via the guardian, and returns CONFIRMED/FAILED (202 only on bounded timeout);
- HSP webhook receiver verifies HMAC, deduplicates events, verifies HashKey RPC before recording, and is idempotent against the submit wait;
- runtime settlement poller is the 30s fallback;
- old Solana submit route and its Solana-specific tests deleted;
- Phase 2 running-budget TODO replaced by non-zero-spend tests.

Phase 3 checkpoint: merged @ `4bb1641`.

Phase 4 delivery (merged @ `1a93662`):
- `agents.address` added (backfilled from legacy `public_key`; compatibility trigger retained until Phase 7), with owner-readable/service-role-write status transitions;
- `mission_agents` role/status/required-capabilities tightened; `agent_challenges` indexed for EVM single-use challenges;
- `AgentChallenge` EIP-712 typed data with purpose binding and no verifying contract;
- owner-initiated challenge/verify flow (agent signs out-of-band; multi-tenant self-serve is post-MVP);
- heartbeat uses EIP-712 `SuccraRequest` agent-only auth, accepts non-current successor agents, and enforces the 30s server-side interval;
- agent status endpoint returns address, heartbeat, status, and mission assignments;
- Phase 3 review notes folded in: migration TODO(phase-7), mirror separation comment, HSP_API_SECRET provisional comment, Phase 3 e2e hashPaymentMandate finding;
- tests: **282 passing**, 1 skipped live Supabase suite; contracts unchanged at 51 passing.

Phase 4 checkpoint: merged @ `1a93662`.

Phase 5 delivery (merged @ `3865500`):
- `SuccraMission.recordViolation` is guardian-only, idempotent by request id, window-aware, and guarded by `stateVersion`; `quarantine` accepts owner or guardian with no threshold requirement for manual freezes;
- `recordSettlement` resets `violationCount` and `lastViolationAt` after a confirmed settlement;
- migration `20261104000000_phase5_audit_events.sql` adds `audit_events.onchain_tx_hash`, removes owner audit writes (owner SELECT only), adds action-request recorder bookkeeping, and enforces the `agents.status` CHECK set;
- preflight writes `violation.counted` only for the PROJECT_SPEC §6 countable reason codes;
- runtime recorder polls unprocessed counted BLOCKs, submits `recordViolation`, detects the threshold, submits quarantine, mirrors mission/agent status, and poisons a row after three failed attempts;
- `POST /api/missions/:id/quarantine` supports owner sessions and the `HASHKEY_GUARDIAN_CREDENTIAL` bearer mode; already-quarantined missions return idempotent 200;
- Phase 4 review notes folded in: `agents.status` CHECK, on-chain-first quarantine mirroring, and successor heartbeats still accepted while `QUARANTINED`;
- tests: **304 passing**, 1 skipped live Supabase suite; contracts **71 passing** (20 new Phase 5 contract tests).

Phase 5 checkpoint: merged @ `3865500`.

Phase 6 delivery on this branch (complete, pending review/merge):
- `SuccraMission` adds strict checkpoint sequences (0, 1, 2, ... via `checkpointCount`), guardian-only `activateSuccessor`, and `acknowledgeRecovery` with direct-agent or guardian-submitted signed ACK;
- canonical checkpoint preimage is `keccak256(abi.encode(...))` over the fixed FR-07 field order; the full snapshot lives in `mission_checkpoints`;
- `succession_events` mirrors activation/ACK state, including nullable pre-confirmation `activation_tx_hash` and one pending activation per mission;
- the runtime initializes sequence=0 checkpoints, auto-commits the next checkpoint after every CONFIRMED settlement, and runs the priority/capability-based succession engine on quarantine;
- `POST/GET /api/missions/:id/succession`, `POST /api/missions/:id/succession/:id/acknowledge`, and guardian-only `POST /api/missions/:id/checkpoints` are implemented;
- Phase 5 review notes folded in: real-Hardhat Phase 6 E2E and `violation.recorded` audit rows (FR-08 permits material Phase 5 events); poisoned-row surfacing remains Phase 9;
- audit names follow the frozen FR-08 Phase 6 list exactly, and no-eligible-successor is represented as `succession.triggered` with `outcome: no_eligible_successor`;
- tests: **334 passing**, 1 skipped live Supabase suite; contracts **101 passing** (30 new Phase 6 contract tests).

Phase 6 checkpoint: merged @ `549629d`.

Phase 7a delivery on branch `phase-7-ux` (complete, pending review/merge):
- `@tanstack/react-query` added; `components/Providers.tsx` wraps the app with wagmi + a single QueryClient.
- Solana Wallet Standard connect replaced by `components/WalletConnect.tsx`: injected wallets plus optional WalletConnect, HashKey mainnet/testnet chain badge, wrong-chain warning, disconnect, EIP-712 sign-in.
- Login auth moved from Ed25519/base58 to EIP-712 `SuccraLogin` typed data (no verifying contract), verified with viem; `profiles.wallet_address` is stored lowercase 0x hex; nonce table/single-use semantics unchanged.
- `POST /api/missions` now validates the FR-01 policy, computes the keccak policy hash and provisional mock Cart Mandate, predicts the CREATE address, stores a DRAFT mirror, and returns the unsigned `MissionFactory.createMission` transaction (plus the architecture-compatible `unsignedTransaction` alias).
- `POST /api/missions/:id/finalize` verifies the receipt, factory `MissionFactoryMissionDeployed` event, mission `MissionCreated` event, policy hash, and on-chain config before activating the mirror, attaching primary/successor agents, and writing `mission.created`.
- Seven-step `/missions/new` wizard, HashKey dashboard columns and mission cards, minimal owner-scoped `/missions/:id` landing page.
- No settlement-token address is fabricated: `NEXT_PUBLIC_DEFAULT_PAYMENT_TOKEN_ADDRESS` is optional and the wizard requires the operator to supply the allowlisted token.
- Tests: **367 passing, 1 skipped live Supabase suite**; contracts **101 passing**.

Phase 7a checkpoint: branch `phase-7-ux` (approved).

Phase 7b delivery on branch `phase-7-ux` (complete, pending review/merge):
- Amendment 1 (option b): `mission.created` is written first with `payload_public.pending=true`; activation mirror writes follow; the same row is marked `pending=false` after activation. An activation failure leaves the mission `DRAFT` with a pending audit row; an audit-insert failure aborts before activation. The idempotent ACTIVE path reconciles a pending row.
- Amendment 2: `formatTokenAmount(atomic, decimals)` and `readTokenDecimals` resolve ERC-20 `decimals()` via viem with a per-process cache, plus an optional explicit `NEXT_PUBLIC_TOKEN_DECIMALS` mapping. No 6/18 default. The mission detail route/page, dashboard cards, wizard conversion, and succession recovery ceiling use the resolved value.
- `GET /api/missions/:id/audit` (owner-only) and `GET /api/missions/:id` added.
- `formatAuditEvent`, `Timeline`, `DecisionReceipt`, `SuccessionPanel`, `MissionTimelinePanel`, and `MissionActions` added; mission detail now shows hero stats, timeline, receipt, succession progress, checkpoint, and owner actions.
- Dashboard cards show latest audit event, token-aware budget, and succession status.
- Blockscout links use `NEXT_PUBLIC_HASHKEY_EXPLORER_URL` (mainnet `https://hashkey.blockscout.com`; testnet `https://testnet-explorer.hsk.xyz`).
- Timeline defensively shows checkpoint-pending and duplicate-checkpoint-sequence badges.
- `payment.confirmed` audit rows are backfilled idempotently from confirmed `hsp_payments` after settlement, so the timeline includes payments without making settlement depend on audit writes.
- ACK-time eligibility re-check in `succession-ack.ts`: quarantined/revoked successors cannot acknowledge.
- Tests: **401 passing, 1 skipped live Supabase suite**; contracts **101 passing**.

Phase 7b checkpoint: branch `phase-7-ux` (pending review/merge).

Phase 7c delivery on branch `phase-7-ux` (complete, pending review/merge):
- Amendment: resolved token decimals and symbol are passed into `Timeline`, `DecisionReceipt`, `MissionTimelinePanel`, `AuditExplorer`, and `SuccessionPanel`; `formatEventAmount` renders `amountAtomic`/`amount_atomic` with `formatTokenAmount`. Unknown decimals fall back to `"N atomic"` and warn in development only. Tests cover 6-decimal and 18-decimal tokens; the Playwright flow asserts `Payment of 200 USDC to …` and `Payment of 100 USDC to …`.
- Added `/agents/[id]`, `/missions/[id]/succession`, `/missions/[id]/audit`, and `/settings`; rewrote the landing page; tightened the mission detail and dashboard layouts.
- Design-system components: `StatusBadge`, `AuthorityMeter`, `AgentIdentityChip`, `CheckpointCard`, `TransactionProof`, `PolicyRuleList`, `EmptyState`, `InlineError`, `ConfirmDialog`, `CopyButton`, and `PageSkeleton`; loading routes for mission, agent, settings, audit, and succession.
- Accessibility/responsive polish: global `:focus-visible`, contrast fixes, status never conveyed by colour alone, and layout checks at 375/768/1024/1440 px.
- Playwright smoke test (`tests/e2e/demo-smoke.spec.ts`) runs against a real local Hardhat node (chain ID 177), the real deployed contracts, the mock HSP, and a test-only PGlite-backed Supabase-shaped client. It exercises create → payment → three blocked violations → quarantine → succession activation → signed ACK → recovery payment, checks axe WCAG A/AA at the landing and audit pages, and screenshots the lifecycle.
- E2E harness is inert unless `SUCCRA_E2E_MODE=1`; it is not used by normal development or production. `@electric-sql/pglite` is externalized from the Next.js server bundle.
- The mock HSP now returns a unique settlement transaction hash per payment so the `hsp_payments.settlement_tx_hash` uniqueness constraint is exercised realistically.
- CI follow-up: the dashboard intentionally has no route-level `loading.tsx`, because streaming the shell turns the anonymous `/dashboard` auth redirect into a 200 response; direct verification returns 307 to `/`. The HSP JWT tamper test now flips a signature byte deterministically instead of relying on a base64url suffix that can be a no-op.
- Tests: **405 passing, 1 skipped live Supabase suite**; contracts **101 passing**; Playwright smoke **1 passing** with axe **0 violations** and no horizontal overflow at all four widths.
- Not run locally: `supabase db lint` and the live Supabase RLS suite, because Docker/Supabase local stack is unavailable in this environment; CI still runs them.

Phase 7c checkpoint: branch `phase-7-ux` (pending review/merge).

Historical next-task note: Phase 7c was awaiting merge to `main` when the HashKey implementation was archived. The merge is not part of R0.

## Frozen architecture
User wallet → Next.js web → Supabase / Succra runtime → SuccraMission contract + x402 facilitator → Robinhood Chain settlement. Mission funds are held by SuccraMission. A runtime-held session key signs EIP-3009 authorizations; the owner registers it, can withdraw at any status, and never signs per payment. Agents communicate through EIP-712-signed requests and never custody mission funds or the session key.

## Frozen MVP
- Robinhood Chain (EVM) only, mainnet 4663 / testnet 46630
- USDG by default or an allowlisted ERC-20 via x402 EIP-3009; ETH is gas only
- program-controlled vault model (Model A)
- SuccraMission holds mission USDG; owner deposits at creation and withdraws unilaterally at any status
- session key registered at creation, held by the runtime, revoked on quarantine, replaced on succession
- allowlisted merchants
- deterministic policy engine
- 3 consecutive blocked policy violations → quarantine
- pre-approved successors
- restricted recovery authority
- verified checkpoints
- audit timeline
- optional AI successor explanation, never authoritative

## Not in MVP
- arbitrary contract calls
- generic agent marketplace
- insurance
- cross-chain
- global agent reputation
- unrestricted agent wallets
- production decentralized keeper network
- withdrawal paths that require agent or guardian cooperation
- direct ERC-20 transfers bypassing x402
- support for Solana

## Current phase
**R4 complete — live mainnet deployment, live UI, and final demo video delivered.**

R0/R0b/R1 are complete. R2/R3 deployed to Robinhood mainnet, passed the real Paxos USDG ERC-1271 probe, and executed the full continuity flow. The UI is live on Vercel against a Render backend with Neon persistence. WIF uses the separately deployed policy-bounded treasury mission because the real WIF token is not EIP-3009 compatible.

## Next phase
Submit the hackathon package, publish the live URLs/addresses, and optionally evaluate an EIP-3009-compatible WIF wrapper before claiming WIF x402 settlement.

## Known design assumptions
- Succra Cloud can go offline; on-chain authority remains intact, but new x402 payments cannot be authorized until the runtime can act. The owner can still withdraw mission USDG directly from SuccraMission.
- The x402 facilitator is the settlement authority; SuccraMission is the authority, policy, and custody layer. The facilitator does not read SuccraMission state.
- EIP-3009 authorizations must have short `validBefore` windows; cancellation cannot revoke an already-signed authorization.
- The runtime-held session key signs EIP-3009 authorizations; the owner never signs per payment, and agents never hold funds, the session key, or token signing keys.
- Variant A depends on the settlement token code-routing through ERC-1271. Paxos USDG passes on mainnet. The real WIF token is a plain ERC-20 and cannot settle through x402 without a wrapper or replacement.
- Variant B's `releaseForPayment` signature does not carry the merchant, so the runtime enforces the merchant allowlist before release and re-checks the signed recipient before submission.
- `approvePayment`/`releaseForPayment` as specified do not carry `agentNonce` or the agent signature; R1 must keep the off-chain single-use request nonce as the replay guard and decide whether to extend the ABI to advance the on-chain counter.
- Guardian is constrained and cannot spend; quarantine revokes the session key. Production should eventually move toward a stronger decentralized guardian/keeper design.
- Mission checkpoint stores deterministic facts, not agent private reasoning.
- The database mirrors on-chain and x402 settlement state; it does not authorize money movement.
- Mission funds are held by SuccraMission; the owner's withdrawal right is unconditional and unilateral. Succra never holds owner signing keys.

## Verification rule
Evidence > agent claim. Do not accept “works” without tests or direct flow verification.
