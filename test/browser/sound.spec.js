import {test, expect} from '@playwright/test';

test('chip Foley decodes, plays at its recorded pitch, and limits repeated playback', async ({page}) => {
  const errors = [], files = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().endsWith('.wav')) files.push({status: response.status(), type: response.headers()['content-type']});
  });
  await page.addInitScript(() => {
    window.audioCheck = {contexts: [], buffers: [], starts: []};
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) { super(...args); window.audioCheck.contexts.push(this); }
      async decodeAudioData(...args) {
        const buffer = await super.decodeAudioData(...args);
        window.audioCheck.buffers.push(buffer); return buffer;
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.audioCheck.starts.push({duration: this.buffer.duration, rate: this.playbackRate.value});
      return start.apply(this, args);
    };
  });
  // The join page loads the same sound module without a costly 3D table scene.
  await page.goto('/join');
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect.poll(() => files.length).toBe(19);
  expect(files.every(file => file.status === 200 && file.type === 'audio/wav')).toBe(true);
  expect(await page.evaluate(() => audioCheck.contexts.length)).toBe(0);
  await page.getByLabel('Your name').click();
  expect(await page.evaluate(async () => (await import('/chip-sound.js')).unlockChipSound())).toBe(true);
  const decoded = await page.evaluate(() => audioCheck.buffers.map(buffer => {
    const pcm = buffer.getChannelData(0);
    return {duration: buffer.duration, energy: pcm.reduce((sum, n) => sum + n * n, 0) / pcm.length};
  }));
  expect(decoded).toHaveLength(19);
  expect(decoded.every(buffer => buffer.energy > .0001 && buffer.duration > .04)).toBe(true);
  // Loaded recordings must play without a CDN/network dependency.
  await page.context().setOffline(true);
  for (const kind of ['lay', 'stack', 'collide', 'handle']) {
    const before = await page.evaluate(() => audioCheck.starts.length);
    await page.evaluate(async kind => (await import('/chip-sound.js')).playChipSound({kind}), kind);
    await expect.poll(() => page.evaluate(() => audioCheck.starts.length)).toBe(before + 1);
    await page.waitForTimeout(200);
  }
  await page.evaluate(async () => {
    audioCheck.starts.length = 0;
    const sound = await import('/chip-sound.js');
    for (let i = 0; i < 200; i++) sound.playChipSound({kind: 'handle', count: 12});
  });
  const burst = await page.evaluate(() => audioCheck.starts);
  expect(burst).toHaveLength(1);
  expect(burst.every(sample => sample.rate === 1 && sample.duration > .2)).toBe(true);
  expect(errors).toEqual([]);
});
