import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { attemptRoutes } from './attempts.js';
import { authRoutes, requireUser } from './auth.js';
import { HttpError } from './httpError.js';

const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));

export function createApp({ db, questions }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/auth', authRoutes(db));
  app.use('/api', requireUser(db), attemptRoutes(db, questions));
  app.use('/api', () => { throw new HttpError(404, 'Not found.'); });

  // After `npm run build` the API also serves the website.
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: dist }));
  }

  app.use((err, req, res, next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
  });
  return app;
}
