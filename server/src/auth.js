import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { HttpError } from './httpError.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const USERNAME = /^[\w.-]{3,30}$/;

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.COOKIE_SECURE === 'true',
};

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':').map((s) => Buffer.from(s, 'hex'));
  return timingSafeEqual(await scryptAsync(password, salt, 64), key);
}

// Verified against when a username does not exist, so both cases take as long.
const dummyHash = hashPassword('dummy');

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function readToken(req) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE && value) return value;
  }
  return null;
}

function readCredentials(body) {
  const { username, password } = body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'Enter a username and password.');
  }
  return { username: username.trim(), password };
}

export const requireUser = (db) => async (req, res, next) => {
  const token = readToken(req);
  const { rows } = token
    ? await db.query(`
        SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)])
    : { rows: [] };
  if (!rows[0]) throw new HttpError(401, 'Please log in.');
  req.user = rows[0];
  next();
};

export function authRoutes(db) {
  const router = Router();
  const failures = new Map(); // "ip|username" -> { count, resetAt }

  async function startSession(res, user) {
    const token = randomBytes(32).toString('hex');
    await db.query('DELETE FROM sessions WHERE expires_at <= now()');
    await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [hashToken(token), user.id, new Date(Date.now() + SESSION_MS)]);
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
    res.json({ id: user.id, username: user.username });
  }

  router.post('/register', async (req, res) => {
    const { username, password } = readCredentials(req.body);
    if (!USERNAME.test(username)) {
      throw new HttpError(400, 'Username must be 3–30 letters, numbers, dots, dashes or underscores.');
    }
    if (password.length < 8 || password.length > 200) {
      throw new HttpError(400, 'Password must be 8–200 characters.');
    }
    const { rows } = await db.query(`
      INSERT INTO users (username, password_hash) VALUES ($1, $2)
      ON CONFLICT DO NOTHING RETURNING id, username`, [username, await hashPassword(password)]);
    if (!rows[0]) throw new HttpError(409, 'That username is taken.');
    res.status(201);
    await startSession(res, rows[0]);
  });

  router.post('/login', async (req, res) => {
    const { username, password } = readCredentials(req.body);
    if (!USERNAME.test(username)) throw new HttpError(401, 'Wrong username or password.');
    const now = Date.now();
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);

    const key = `${req.ip}|${username.toLowerCase()}`;
    const entry = failures.get(key) ?? { count: 0, resetAt: now + WINDOW_MS };
    if (entry.count >= MAX_FAILURES) {
      throw new HttpError(429, 'Too many failed logins. Try again in 15 minutes.');
    }
    // Counted before the slow check so parallel guesses can't slip past the limit.
    entry.count += 1;
    failures.set(key, entry);

    const { rows: [user] } = await db.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    const ok = await verifyPassword(password, user?.password_hash ?? await dummyHash);
    if (!user || !ok) throw new HttpError(401, 'Wrong username or password.');
    failures.delete(key);
    await startSession(res, user);
  });

  router.post('/logout', async (req, res) => {
    const token = readToken(req);
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  });

  router.get('/me', requireUser(db), (req, res) => res.json(req.user));
  return router;
}
