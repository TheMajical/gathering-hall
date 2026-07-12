/**
 * Room snapshot persistence. Debounced per-room writes; atomic via
 * write-tmp → fsync → rename. Snapshots are version-gated on restore:
 * an engineVersion mismatch marks the room unrecoverable rather than
 * risking silent corruption.
 */
import { getGameSpec } from '@gamehub/shared';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export const SCHEMA_VERSION = 1;
const DEBOUNCE_MS = 2000;
const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;

export interface PersistedSeat {
  playerId: number;
  name: string;
  token: string;
}

export interface RoomSnapshot {
  schemaVersion: number;
  code: string;
  gameId: string;
  engineVersion: number;
  phase: 'lobby' | 'playing' | 'finished';
  seats: PersistedSeat[];
  state: unknown | null;
  seq: number;
  savedAt: number;
}

export class Persistence {
  private timers = new Map<string, NodeJS.Timeout>();
  private pending = new Map<string, () => RoomSnapshot>();

  constructor(private dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  private fileFor(code: string): string {
    return path.join(this.dataDir, `room-${code}.json`);
  }

  /** Debounced save; `snapshot` is re-taken at flush time so it's never stale. */
  scheduleSave(code: string, snapshot: () => RoomSnapshot): void {
    this.pending.set(code, snapshot);
    if (this.timers.has(code)) return;
    this.timers.set(
      code,
      setTimeout(() => {
        this.timers.delete(code);
        void this.flushRoom(code);
      }, DEBOUNCE_MS),
    );
  }

  private async flushRoom(code: string): Promise<void> {
    const take = this.pending.get(code);
    if (!take) return;
    this.pending.delete(code);
    try {
      await this.writeAtomic(this.fileFor(code), JSON.stringify(take()));
    } catch (e) {
      console.error(`[persistence] failed to save room ${code}:`, e);
    }
  }

  private async writeAtomic(file: string, data: string): Promise<void> {
    const tmp = `${file}.tmp`;
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, file);
  }

  /** Synchronous flush of everything pending — used on SIGTERM. */
  flushAllSync(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const [code, take] of this.pending) {
      try {
        const file = this.fileFor(code);
        const tmp = `${file}.tmp`;
        const fd = fs.openSync(tmp, 'w');
        try {
          fs.writeFileSync(fd, JSON.stringify(take()), 'utf8');
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
      } catch (e) {
        console.error(`[persistence] SIGTERM flush failed for ${code}:`, e);
      }
    }
    this.pending.clear();
  }

  delete(code: string): void {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
    this.pending.delete(code);
    fs.rmSync(this.fileFor(code), { force: true });
  }

  /** Load all valid snapshots; drop stale/corrupt/mismatched ones. */
  restore(): RoomSnapshot[] {
    const out: RoomSnapshot[] = [];
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dataDir).filter((f) => /^room-[A-Z0-9]+\.json$/.test(f));
    } catch {
      return out;
    }
    for (const f of files) {
      const full = path.join(this.dataDir, f);
      try {
        const snap = JSON.parse(fs.readFileSync(full, 'utf8')) as RoomSnapshot;
        if (snap.schemaVersion !== SCHEMA_VERSION) {
          console.warn(`[persistence] ${f}: schema v${snap.schemaVersion} != v${SCHEMA_VERSION}, dropping`);
          fs.rmSync(full, { force: true });
          continue;
        }
        const spec = getGameSpec(snap.gameId);
        if (snap.state !== null && (!spec || spec.engineVersion !== snap.engineVersion)) {
          console.warn(`[persistence] ${f}: engine version mismatch for ${snap.gameId}, dropping game state`);
          fs.rmSync(full, { force: true });
          continue;
        }
        if (snap.phase === 'finished' && Date.now() - snap.savedAt > FINISHED_TTL_MS) {
          fs.rmSync(full, { force: true });
          continue;
        }
        out.push(snap);
      } catch (e) {
        console.error(`[persistence] ${f}: unreadable, dropping (${String(e)})`);
        fs.rmSync(full, { force: true });
      }
    }
    return out;
  }

  /** Remove finished-room snapshots older than the TTL (run hourly). */
  gc(): void {
    for (const snap of this.restore()) {
      if (snap.phase === 'finished' && Date.now() - snap.savedAt > FINISHED_TTL_MS) {
        this.delete(snap.code);
      }
    }
  }
}
