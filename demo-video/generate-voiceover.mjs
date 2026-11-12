import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('contracts/.env.local');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    })
);

const apiKey = env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is missing.');

const voiceId = 'EXAVITQu4vr4xnSDxMaL';
const modelId = 'eleven_turbo_v2_5';
const scenes = [
  {
    id: 'scene1',
    text:
      'When an autonomous AI agent manages real money, there is a fatal flaw. If the agent fails, goes rogue, or gets compromised, the mission dies with it.',
  },
  {
    id: 'scene2',
    text:
      'Succra fixes this. It is the continuity layer for agent payments. Agents can fail, but missions do not have to.',
  },
  {
    id: 'scene3',
    text:
      'The owner creates a mission, deposits USDG or WIF into a program-controlled vault, and registers a scoped session key. The owner can withdraw at any time.',
  },
  {
    id: 'scene4',
    text:
      'The agent requests a payment. Succra checks policy, approves the EIP-712 hash, and the session key signs an x402 EIP-3009 authorization. Settlement is verified on chain.',
  },
  {
    id: 'scene5',
    text:
      'Three policy violations change everything. Succra quarantines the agent, revokes the session key, and preserves the last verified checkpoint. A pre-approved successor takes over with a lower recovery ceiling.',
  },
  {
    id: 'scene6',
    text:
      'The mission continues. New authority, same mission, real on chain state. Succra. Agents can fail. Missions do not have to.',
  },
];

const outputDir = path.resolve('demo-video/audio');
fs.mkdirSync(outputDir, { recursive: true });

for (const scene of scenes) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: scene.text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`${scene.id}: ${response.status} ${await response.text()}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(outputDir, `${scene.id}.mp3`), bytes);
  console.log(`${scene.id}: ${bytes.length} bytes`);
}
