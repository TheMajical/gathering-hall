import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, '../../data');
const CLIENT_DIR = process.env.CLIENT_DIR ?? path.resolve(here, '../../client/dist');

const { httpServer, persistence } = createApp({ dataDir: DATA_DIR, clientDir: CLIENT_DIR });

httpServer.listen(PORT, () => {
  console.log(`[gamehub] listening on :${PORT} (data: ${DATA_DIR}, client: ${CLIENT_DIR})`);
});

// Hourly snapshot GC for finished games.
setInterval(() => persistence.gc(), 60 * 60 * 1000).unref();

function shutdown(signal: string): void {
  console.log(`[gamehub] ${signal} — flushing snapshots`);
  persistence.flushAllSync();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
