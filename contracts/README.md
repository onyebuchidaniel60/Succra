# Succra contracts

Hardhat workspace for `SuccraMission`, `MissionFactory`, and `GuardianRegistry`.

## Tests

Run contract tests with:

```bash
pnpm --filter @succra/contracts build
pnpm --filter @succra/contracts test
```

Contract test files under `contracts/test/` are executed by Hardhat and
type-checked at test time, not by the workspace `tsc` pass.
