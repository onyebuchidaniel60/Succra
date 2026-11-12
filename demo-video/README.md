# Succra demo video

## Final file

`demo-video/succra_demo.mp4` — 1920×1080, H.264/AAC, 68.3s.

## Source assets

- `demo-video/audio/scene1.mp3` … `scene6.mp3` — ElevenLabs, voice `EXAVITQu4vr4xnSDxMaL`, model `eleven_turbo_v2_5`, stability 0.5, similarity 0.75
- `demo-video/music.mp3` — “Lounge Noir” by Fesliyan Studios (royalty-free)
- `demo-video/playwright/raw.webm` — Playwright 1080p screen capture
- `demo-video/voiceover.wav` — scene-aligned voice track
- `demo-video/timings.json` — recorded scene start/caption timings
- `demo-video/state.json` — final on-chain demo state and transaction hashes

## Scene narration

1. **The fatal flaw** — “When an autonomous AI agent manages real money, there is a fatal flaw. If the agent fails, goes rogue, or gets compromised, the mission dies with it.”
2. **The continuity layer** — “Succra fixes this. It is the continuity layer for agent payments. Agents can fail, but missions do not have to.”
3. **Vault + session key** — “The owner creates a mission, deposits USDG or WIF into a program-controlled vault, and registers a scoped session key. The owner can withdraw at any time.”
4. **x402 payment** — “The agent requests a payment. Succra checks policy, approves the EIP-712 hash, and the session key signs an x402 EIP-3009 authorization. Settlement is verified on chain.”
5. **Quarantine → succession** — “Three policy violations change everything. Succra quarantines the agent, revokes the session key, and preserves the last verified checkpoint. A pre-approved successor takes over with a lower recovery ceiling.”
6. **Recovery** — “The mission continues. New authority, same mission, real on chain state. Succra. Agents can fail. Missions do not have to.”

## Rebuild

```bash
# 1. Compile contracts and start a local chain
cd contracts && npx hardhat compile && npx hardhat node

# 2. Start the web app
cd ..
SUCCRA_ROOT=$PWD SUCCRA_E2E_MODE=1 pnpm --filter @succra/web dev

# 3. Generate voiceover (requires ELEVENLABS_API_KEY)
node demo-video/generate-voiceover.mjs

# 4. Record the Playwright choreography
node apps/web/tests/record-demo.mjs

# 5. Build the scene-aligned voice track and final render
#    (see the ffmpeg commands in the build transcript)
```
