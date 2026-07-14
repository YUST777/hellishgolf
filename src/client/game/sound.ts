/**
 * Sound effects, mirrored from Kinda Hard Golf. The original uses Howler.js and
 * loads each SFX as `${name}.ogg` / `.mp3`. We use plain HTMLAudioElement pools
 * (no extra dependency) with the exact same mirrored audio files and the same
 * playback volumes pulled from the game bundle.
 *
 * Sound map (bundle `On` enum -> file, in public/game/audio/):
 *   BallHit    impactPlate_light_003   (shot / club hit)
 *   BallBounce footstep_wood_003       (wall/ground bounce)
 *   Splash     rock_splash             (water hazard)
 *   Chime      loading_chime           (level ready)
 *   Claps      slowclap                (finish)
 *   Back       click_002               (ui)
 *   Leaves     leaves                  (rough)
 *   Squawk     squawk                  (bird)
 *   Ambient    ambient_birds           (background loop)
 */

const BASE = 'game/audio';

export type Sfx =
  | 'BallHit'
  | 'BallBounce'
  | 'Splash'
  | 'Chime'
  | 'Claps'
  | 'Back'
  | 'Leaves'
  | 'Squawk'
  | 'Ambient';

const FILES: Record<Sfx, string> = {
  BallHit: 'impactPlate_light_003',
  BallBounce: 'footstep_wood_003',
  Splash: 'rock_splash',
  Chime: 'loading_chime',
  Claps: 'slowclap',
  Back: 'click_002',
  Leaves: 'leaves',
  Squawk: 'squawk',
  Ambient: 'ambient_birds',
};

/** Pick the audio type the browser can play (ogg preferred, mp3 fallback). */
function pickExt(): 'ogg' | 'mp3' {
  const a = document.createElement('audio');
  if (a.canPlayType('audio/ogg; codecs="vorbis"')) return 'ogg';
  return 'mp3';
}

class SoundManager {
  private ext: 'ogg' | 'mp3' = 'mp3';
  private pools = new Map<Sfx, HTMLAudioElement[]>();
  private ambient: HTMLAudioElement | null = null;
  private muted = false;
  private ready = false;

  init() {
    if (this.ready) return;
    this.ext = pickExt();
    // Build a tiny pool per SFX so rapid repeats (bounces) can overlap.
    (Object.keys(FILES) as Sfx[]).forEach((key) => {
      if (key === 'Ambient') return;
      const pool: HTMLAudioElement[] = [];
      for (let i = 0; i < 4; i++) {
        const el = new Audio(`${BASE}/${FILES[key]}.${this.ext}`);
        el.preload = 'auto';
        pool.push(el);
      }
      this.pools.set(key, pool);
    });
    this.ready = true;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m && this.ambient) this.ambient.pause();
    else if (!m && this.ambient) void this.ambient.play().catch(() => {});
  }

  isMuted() {
    return this.muted;
  }

  /** Play a one-shot SFX at the given volume (0..1). */
  play(key: Sfx, volume = 1) {
    if (this.muted || !this.ready) return;
    const pool = this.pools.get(key);
    if (!pool) return;
    // Find a free (ended / not started) element, else steal the oldest.
    const el =
      pool.find((a) => a.paused || a.ended || a.currentTime === 0) ?? pool[0]!;
    try {
      el.currentTime = 0;
      el.volume = Math.max(0, Math.min(1, volume));
      void el.play().catch(() => {});
    } catch {
      /* ignore autoplay/interaction errors */
    }
  }

  /** Start the looping ambient birdsong bed (quiet). */
  startAmbient(volume = 0.15) {
    if (!this.ready) return;
    if (!this.ambient) {
      this.ambient = new Audio(`${BASE}/${FILES.Ambient}.${this.ext}`);
      this.ambient.loop = true;
      this.ambient.volume = volume;
    }
    if (!this.muted) void this.ambient.play().catch(() => {});
  }
}

export const sound = new SoundManager();
