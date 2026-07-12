/**
 * Local sound effects. Real CC0 recordings (.ogg, from Kenney asset packs —
 * see /sounds/CREDITS.txt) with synthesized .wav fallbacks for browsers
 * without ogg-vorbis support (iOS Safari). Everything ships from our own
 * server — no external URLs. Failures (e.g. autoplay policy before the first
 * user gesture) are swallowed silently.
 */
export type SoundName =
  | 'dice'
  | 'attack'
  | 'conquer'
  | 'place'
  | 'card'
  | 'trade'
  | 'eliminated'
  | 'victory'
  | 'turn';

/** Sounds that only exist as synthesized WAV (no recorded equivalent). */
const WAV_ONLY: ReadonlySet<SoundName> = new Set(['victory'] as SoundName[]);

const oggSupported: boolean = (() => {
  try {
    return new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
  } catch {
    return false;
  }
})();

const cache = new Map<SoundName, HTMLAudioElement>();

export function isMuted(): boolean {
  return localStorage.getItem('gh:muted') === '1';
}

export function setMuted(m: boolean): void {
  localStorage.setItem('gh:muted', m ? '1' : '0');
}

export function playSound(name: SoundName): void {
  if (isMuted()) return;
  try {
    let base = cache.get(name);
    if (!base) {
      const ext = oggSupported && !WAV_ONLY.has(name) ? 'ogg' : 'wav';
      base = new Audio(`/sounds/${name}.${ext}`);
      base.preload = 'auto';
      cache.set(name, base);
    }
    const a = base.cloneNode() as HTMLAudioElement;
    a.volume = 0.5;
    void a.play().catch(() => {});
  } catch {
    /* audio unavailable — never break the game over a sound */
  }
}
