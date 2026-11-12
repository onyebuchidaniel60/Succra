import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const audioDir = path.join(root, 'demo-video', 'audio');
const outDir = path.join(root, 'demo-video', 'playwright-mainnet');
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = process.env.DEMO_BASE_URL ?? 'https://succra.vercel.app';
const usdgMission = '0x37522496E38f7859C96bCAC058d23f7296BB646b';
const wifMission = '0x84Dab564B5d553686A2980Ddb42E0ac7Fe3Feed1';
const scenes = [
  { number: 1, path: '/', title: 'The fatal flaw', body: 'Money-managing agents die with the agent.' },
  { number: 2, path: '/dashboard', title: 'The continuity layer', body: 'Agents can fail. Missions continue.' },
  { number: 3, path: '/missions/new', title: 'Vault + session key', body: 'Deposit USDG or WIF. Withdraw any time.' },
  { number: 4, path: `/missions/${usdgMission}`, title: 'x402 payment', body: 'Live Paxos USDG · EIP-3009 · ERC-1271 PASS.' },
  { number: 5, path: '/dashboard', title: 'Quarantine → succession', body: 'Three violations revoke authority. A successor continues.' },
  { number: 6, path: `/missions/${usdgMission}`, title: 'Recovery', body: 'New authority. Same mission.' },
].map((scene) => {
  const file = path.join(audioDir, `scene${scene.number}.mp3`);
  const duration = Number(
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ]).toString().trim()
  );
  return { ...scene, duration };
});

function holdMs(captionAt, durationSeconds) {
  const remaining = (durationSeconds + 0.35) * 1000 - (Date.now() - captionAt);
  return remaining > 0 ? remaining : 0;
}

const browser = await chromium.launch({ headless: true, slowMo: 55 });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
const recordStart = Date.now();
const timings = [];

for (const scene of scenes) {
  const start = Date.now();
  await page.goto(`${baseUrl}${scene.path}`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(2200);
  await page.evaluate(({ number, title, body }) => {
    const existing = document.getElementById('succra-scene-caption');
    existing?.remove();
    const node = document.createElement('div');
    node.id = 'succra-scene-caption';
    node.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
      'width:min(92vw,780px)', 'z-index:2147483647', 'background:rgba(8,11,15,0.92)',
      'border:1px solid rgba(232,255,99,0.22)', 'border-radius:14px',
      'padding:14px 20px', 'backdrop-filter:blur(14px)', 'color:#f4f4f5',
      'font-family:Inter,ui-sans-serif,system-ui,sans-serif',
      'box-shadow:0 24px 80px rgba(0,0,0,0.55)',
    ].join(';');
    node.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:#e8ff63">
        <span>Scene 0${number} / 06</span><span style="flex:1;height:1px;background:rgba(255,255,255,0.12)"></span><span style="color:#71717a">SUCCRA · continuity layer</span>
      </div>
      <div style="margin-top:6px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <span style="font-size:18px;font-weight:600;color:#fafafa">${title}</span>
        <span style="font-size:14px;color:#a1a1aa">${body}</span>
      </div>`;
    document.body.appendChild(node);
  }, scene);
  const captionAt = Date.now();
  timings.push({
    scene: scene.number,
    captionSeconds: (captionAt - recordStart) / 1000,
    audioSeconds: scene.duration,
  });
  if (scene.number === 3) await page.mouse.wheel(0, 420);
  if (scene.number === 6) await page.mouse.wheel(0, 380);
  await page.waitForTimeout(350);
  const remaining = holdMs(captionAt, scene.duration);
  if (remaining > 0) await page.waitForTimeout(remaining);
  console.log(`scene ${scene.number}: ${scene.duration.toFixed(3)}s`);
}

const video = page.video();
await context.close();
const videoPath = await video.path();
const finalPath = path.join(outDir, 'raw.webm');
fs.copyFileSync(videoPath, finalPath);
fs.writeFileSync(
  path.join(root, 'demo-video', 'mainnet-timings.json'),
  JSON.stringify(timings, null, 2)
);
await browser.close();
console.log(`video=${finalPath}`);
