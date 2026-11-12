/* global process, fetch, window, CustomEvent, document, console */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const audioDir = path.join(root, 'demo-video', 'audio');
const outDir = path.join(root, 'demo-video', 'playwright');
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = process.env.DEMO_BASE_URL ?? 'http://localhost:3002';
const scenes = [1, 2, 3, 4, 5, 6].map((number) => {
  const file = path.join(audioDir, `scene${number}.mp3`);
  const duration = Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      file,
    ]).toString().trim()
  );
  return { number, duration };
});

function holdMs(sceneStart, durationSeconds) {
  const target = (durationSeconds + 0.35) * 1000;
  const remaining = target - (Date.now() - sceneStart);
  return remaining > 0 ? remaining : 0;
}

async function clickAction(page, action) {
  const button = page.getByTestId(`action-${action}`);
  const box = await button.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await page.waitForTimeout(140);
  }
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/demo') && candidate.request().method() === 'POST',
      { timeout: 120_000 }
    ),
    button.click(),
  ]);
  const body = await response.json().catch(() => null);
  if (!response.ok() || !body?.ok) {
    throw new Error(`Demo action ${action} failed: ${JSON.stringify(body)}`);
  }
  await page.waitForTimeout(450);
}

const browser = await chromium.launch({ headless: true, slowMo: 65 });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
const recordStart = Date.now();
const timings = [];

await fetch(`${baseUrl}/api/demo`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'reset' }),
});

await page.goto(`${baseUrl}/demo?scene=1`, { waitUntil: 'networkidle' });
await page.getByTestId('mission-usdg').waitFor({ state: 'visible' });
await page.getByTestId('scene-caption').waitFor({ state: 'visible' });

for (const scene of scenes) {
  const sceneStart = Date.now();
  const timing = {
    scene: scene.number,
    startSeconds: (sceneStart - recordStart) / 1000,
    captionSeconds: 0,
    audioSeconds: scene.duration,
  };
  timings.push(timing);

  if (scene.number > 1) {
    await page.evaluate((number) => {
      window.dispatchEvent(new CustomEvent('succra-scene', { detail: number }));
    }, scene.number);
    await page.waitForFunction(
      (number) =>
        document
          .querySelector('[data-testid="scene-caption"]')
          ?.getAttribute('data-scene') === String(number),
      scene.number
    );
  }
  const captionAt = Date.now();
  timing.captionSeconds = (captionAt - recordStart) / 1000;
  await page.waitForTimeout(350);

  if (scene.number === 3) {
    await page.evaluate(() => window.scrollTo({ top: 380, behavior: 'smooth' }));
    await page.waitForTimeout(500);
    await clickAction(page, 'reset');
  }
  if (scene.number === 4) {
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
    await page.waitForTimeout(500);
    await clickAction(page, 'usdg-payment');
    await page.waitForTimeout(1_500);
    await clickAction(page, 'wif-payment');
  }
  if (scene.number === 5) {
    await page.evaluate(() => window.scrollTo({ top: 560, behavior: 'smooth' }));
    await page.waitForTimeout(450);
    await clickAction(page, 'violations');
    await page.waitForTimeout(800);
    await clickAction(page, 'quarantine');
    await page.waitForTimeout(800);
    await clickAction(page, 'succession');
  }
  if (scene.number === 6) {
    await page.evaluate(() => window.scrollTo({ top: 760, behavior: 'smooth' }));
    await page.waitForTimeout(450);
    await clickAction(page, 'recovery');
  }

  const remaining = holdMs(captionAt, scene.duration);
  if (remaining > 0) await page.waitForTimeout(remaining);
  console.log(`scene ${scene.number}: ${scene.duration.toFixed(3)}s`);
}

const stateResponse = await fetch(`${baseUrl}/api/demo`);
const stateBody = await stateResponse.json();
fs.writeFileSync(
  path.join(root, 'demo-video', 'state.json'),
  JSON.stringify(stateBody.state ?? stateBody, null, 2)
);
fs.writeFileSync(
  path.join(root, 'demo-video', 'timings.json'),
  JSON.stringify(timings, null, 2)
);

const video = page.video();
await context.close();
const videoPath = await video.path();
const finalPath = path.join(root, 'demo-video', 'playwright', 'raw.webm');
fs.copyFileSync(videoPath, finalPath);
await browser.close();
console.log(`video=${finalPath}`);
