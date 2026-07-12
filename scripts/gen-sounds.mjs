/**
 * Synthesizes the game's sound effects as WAV files into client/public/sounds/.
 * Everything is generated locally — no downloads, no licensing, fully offline.
 * Run: node scripts/gen-sounds.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050; // sample rate
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../client/public/sounds');
mkdirSync(OUT, { recursive: true });

// ---------- tiny synth toolkit ----------
const seconds = (s) => Math.floor(s * SR);

/** Sine tone with exponential decay. */
function tone(freq, dur, { decay = 6, gain = 1, harmonics = [] } = {}) {
  const n = seconds(dur);
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = Math.sin(2 * Math.PI * freq * t);
    for (const [mult, hGain] of harmonics) v += hGain * Math.sin(2 * Math.PI * freq * mult * t);
    buf[i] = v * gain * Math.exp(-decay * t);
  }
  return buf;
}

/** White noise burst with exponential decay and a crude one-pole lowpass. */
function noise(dur, { decay = 12, gain = 1, lowpass = 1 } = {}) {
  const n = seconds(dur);
  const buf = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const white = Math.random() * 2 - 1;
    prev = prev + lowpass * (white - prev); // lowpass<1 → muffled
    buf[i] = prev * gain * Math.exp(-decay * t);
  }
  return buf;
}

/** Mix source into target starting at `at` seconds. */
function mixAt(target, source, at) {
  const off = seconds(at);
  for (let i = 0; i < source.length && off + i < target.length; i++) target[off + i] += source[i];
}

function silence(dur) {
  return new Float64Array(seconds(dur));
}

/** Normalize to 0.85 peak and write 16-bit mono WAV. */
function writeWav(name, buf) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0 ? 0.85 / peak : 1;
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    data.writeInt16LE(Math.round(buf[i] * scale * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(OUT, `${name}.wav`), Buffer.concat([header, data]));
  console.log(`  ${name}.wav (${((header.length + data.length) / 1024).toFixed(1)} KB)`);
}

// ---------- the effects ----------
console.log(`Generating sounds into ${OUT}`);

{
  // dice: a rattle of short muffled clicks
  const buf = silence(0.45);
  for (const [at, pitch] of [[0, 900], [0.07, 700], [0.16, 1100], [0.24, 800], [0.33, 950]]) {
    mixAt(buf, noise(0.06, { decay: 60, lowpass: 0.5, gain: 0.9 }), at);
    mixAt(buf, tone(pitch, 0.05, { decay: 70, gain: 0.25 }), at);
  }
  writeWav('dice', buf);
}

{
  // attack: sharp clash — noise crack plus metallic ring
  const buf = silence(0.5);
  mixAt(buf, noise(0.12, { decay: 35, lowpass: 0.9, gain: 1 }), 0);
  mixAt(buf, tone(880, 0.45, { decay: 9, gain: 0.5, harmonics: [[2.76, 0.4], [5.4, 0.2]] }), 0.02);
  writeWav('attack', buf);
}

{
  // conquer: quick rising triumphant triad
  const buf = silence(0.7);
  mixAt(buf, tone(392, 0.25, { decay: 8, gain: 0.7 }), 0);
  mixAt(buf, tone(523.25, 0.25, { decay: 8, gain: 0.7 }), 0.12);
  mixAt(buf, tone(659.25, 0.45, { decay: 6, gain: 0.8, harmonics: [[2, 0.3]] }), 0.24);
  writeWav('conquer', buf);
}

{
  // place: soft army thump
  const buf = silence(0.2);
  mixAt(buf, tone(130, 0.18, { decay: 25, gain: 1, harmonics: [[0.5, 0.5]] }), 0);
  mixAt(buf, noise(0.04, { decay: 90, lowpass: 0.3, gain: 0.5 }), 0);
  writeWav('place', buf);
}

{
  // card: paper swish
  const buf = silence(0.3);
  const sw = noise(0.28, { decay: 10, lowpass: 0.75, gain: 1 });
  // fade-in to make it a swish rather than a crack
  for (let i = 0; i < sw.length; i++) sw[i] *= Math.min(1, (i / sw.length) * 4) * (1 - i / sw.length);
  mixAt(buf, sw, 0);
  writeWav('card', buf);
}

{
  // trade: coin chime
  const buf = silence(0.7);
  mixAt(buf, tone(1318.5, 0.6, { decay: 7, gain: 0.6 }), 0);
  mixAt(buf, tone(1760, 0.55, { decay: 8, gain: 0.45 }), 0.06);
  mixAt(buf, noise(0.03, { decay: 100, lowpass: 0.9, gain: 0.3 }), 0);
  writeWav('trade', buf);
}

{
  // eliminated: low doom boom
  const buf = silence(1.0);
  mixAt(buf, tone(72, 0.95, { decay: 4.5, gain: 1, harmonics: [[2, 0.3], [2.98, 0.15]] }), 0);
  mixAt(buf, noise(0.3, { decay: 12, lowpass: 0.25, gain: 0.6 }), 0);
  writeWav('eliminated', buf);
}

{
  // victory: fanfare arpeggio
  const buf = silence(1.5);
  const notes = [261.63, 329.63, 392, 523.25];
  notes.forEach((f, i) => mixAt(buf, tone(f, 0.5, { decay: 4, gain: 0.6, harmonics: [[2, 0.35]] }), i * 0.16));
  mixAt(buf, tone(783.99, 0.8, { decay: 3, gain: 0.5, harmonics: [[2, 0.3]] }), 0.64);
  writeWav('victory', buf);
}

{
  // turn: soft bell — "you're up"
  const buf = silence(0.6);
  mixAt(buf, tone(659.25, 0.55, { decay: 6, gain: 0.6, harmonics: [[2, 0.4], [3, 0.15]] }), 0);
  writeWav('turn', buf);
}

console.log('done.');
