// Actual chip Foley from Kenney's CC0 Casino Audio pack. These are recordings,
// not synthesized clicks. Keep their original pitch and frequency response.
const definitions = {
  lay: {prefix: 'lay', count: 3, level: .75},
  collide: {prefix: 'collide', count: 4, level: .75},
  handle: {prefix: 'handle', count: 6, level: .55},
  stack: {prefix: 'stack', count: 6, level: .7},
};
const recordings = Object.entries(definitions).flatMap(([kind, definition]) =>
  Array.from({length: definition.count}, (_, index) => {
    const url = new URL(`./audio/chips/${definition.prefix}-${index + 1}.wav`, import.meta.url);
    // Fetch from the laptop as the page loads, before a player's first touch.
    const bytes = fetch(url).then(response => {
      if (!response.ok) throw new Error(`Missing chip recording: ${url.pathname}`);
      return response.arrayBuffer();
    }).catch(() => null);
    return {kind, index, bytes};
  })
);

let context, master, ready;
const samples = new Map();
const previous = new Map();
let contactUntil = 0, handlingUntil = 0, voices = 0;

export function unlockChipSound() {
  try {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return Promise.resolve(false);
      context = new AudioContext({latencyHint: 'interactive'});
      master = context.createGain();
      master.gain.value = .65;
      // A transparent limiter prevents overlapping impacts from clipping.
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 3; limiter.ratio.value = 8;
      limiter.attack.value = .002; limiter.release.value = .06;
      master.connect(limiter); limiter.connect(context.destination);
      ready = Promise.all(recordings.map(async recording => {
        const bytes = await recording.bytes;
        if (!bytes) return;
        try {
          const buffer = await context.decodeAudioData(bytes);
          const group = samples.get(recording.kind) || [];
          group.push({buffer, index: recording.index}); samples.set(recording.kind, group);
        } catch { /* A failed sample must not prevent the game from working. */ }
      })).then(() => samples.size === Object.keys(definitions).length);
    }
    // Call this directly from a touch/click so iOS and Android allow audio.
    const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
    return Promise.all([ready, resumed]).then(([loaded]) => loaded).catch(() => false);
  } catch { return Promise.resolve(false); }
}

function play({kind, count, intensity}) {
  if (context.state !== 'running' || voices >= 4) return;
  let group = samples.get(kind);
  if (!group?.length) return;
  const now = context.currentTime;
  if (kind === 'handle') {
    if (now < handlingUntil || now < contactUntil) return;
    // A single loose chip gets a brief handling sound; a group gets a shuffle.
    const suitable = group.filter(sample => count > 1 ? sample.index !== 0 && sample.index !== 2 : sample.index === 0 || sample.index === 2);
    if (suitable.length) group = suitable;
  } else {
    if (now < contactUntil) return;
    contactUntil = now + .045;
  }
  const alternatives = group.filter(sample => sample !== previous.get(kind));
  const choices = alternatives.length ? alternatives : group;
  const sample = choices[Math.floor(Math.random() * choices.length)];
  previous.set(kind, sample);
  // Handling/stack recordings already contain several contacts. Don't multiply
  // them for every chip or for every pointer event.
  const layers = kind === 'lay' || kind === 'collide' ? Math.min(count, 2, 4 - voices) : 1;
  if (kind === 'handle') handlingUntil = now + sample.buffer.duration;
  for (let i = 0; i < layers; i++) {
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = i ? group[Math.floor(Math.random() * group.length)].buffer : sample.buffer;
    gain.gain.value = definitions[kind].level * intensity * (i ? .45 : 1);
    source.connect(gain); gain.connect(master); voices++;
    source.onended = () => { voices--; source.disconnect(); gain.disconnect(); };
    source.start(now + i * .032);
  }
}

export function playChipSound({kind = 'lay', count = 1, intensity = 1} = {}) {
  // Physics can start before anyone has interacted. Never open an AudioContext
  // or queue autoplay sounds until the user has unlocked audio with a gesture.
  if (!context || !definitions[kind] || count <= 0) return;
  const options = {kind, count, intensity: Math.max(0, Math.min(1, intensity))};
  if (samples.has(kind) && context.state === 'running') { play(options); return; }
  const requestedAt = performance.now();
  ready?.then(() => {
    // If loading is unusually slow, discard stale gestures rather than playing
    // a burst of old sounds after the player's hand has stopped moving.
    if (performance.now() - requestedAt < 200) play(options);
  });
}
