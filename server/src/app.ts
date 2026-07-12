/**
 * App factory — separated from index.ts so integration tests can boot the
 * full server on an ephemeral port.
 */
import express from 'express';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { Server } from 'socket.io';
import { Persistence } from './persistence.js';
import { RoomManager } from './roomManager.js';
import { attachHandlers } from './socketHandlers.js';

export interface AppHandles {
  httpServer: http.Server;
  io: Server;
  rooms: RoomManager;
  persistence: Persistence;
}

export function createApp(opts: { dataDir: string; clientDir?: string }): AppHandles {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: true },
    // Through a tunnel, generous ping settings avoid spurious disconnects.
    pingTimeout: 30_000,
    pingInterval: 25_000,
  });

  const persistence = new Persistence(opts.dataDir);
  const rooms = new RoomManager(io, persistence);
  attachHandlers(io, rooms);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });

  if (opts.clientDir && fs.existsSync(opts.clientDir)) {
    const index = path.join(opts.clientDir, 'index.html');
    // Hashed build assets are immutable → cache hard. Everything else
    // (index.html, sounds) must revalidate, or browsers serve a stale page
    // pointing at bundle hashes that no longer exist (= blank screen).
    app.use(
      express.static(opts.clientDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    // SPA fallback for client-side routes.
    app.get('*', (_req, res) => res.sendFile(index, { headers: { 'Cache-Control': 'no-cache' } }));
  }

  return { httpServer, io, rooms, persistence };
}
