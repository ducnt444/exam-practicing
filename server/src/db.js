import pg from 'pg';

export function openDb(options) {
  const pool = new pg.Pool(options);
  // Without this, losing an idle connection would crash the process.
  pool.on('error', (err) => console.error('Postgres connection lost:', err.message));
  return pool;
}

export async function migrate(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      username text NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (lower(username));

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );

    -- finished_at IS NULL means in progress. Only finished attempts are history.
    CREATE TABLE IF NOT EXISTS attempts (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_id text NOT NULL,
      exam_title text NOT NULL,
      total integer NOT NULL,
      correct_count integer,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS attempts_user ON attempts (user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt
      ON attempts (user_id) WHERE finished_at IS NULL;

    -- snapshot freezes the question as it was when the test started, so editing
    -- the question bank never changes the meaning of past results.
    CREATE TABLE IF NOT EXISTS attempt_questions (
      attempt_id integer NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      position integer NOT NULL,
      question_id text NOT NULL,
      snapshot jsonb NOT NULL,
      selected jsonb NOT NULL DEFAULT '[]',
      is_correct boolean,
      PRIMARY KEY (attempt_id, position)
    );
  `);
}

export async function transaction(db, fn) {
  const client = await db.connect();
  let broken;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((e) => { broken = e; });
    throw err;
  } finally {
    client.release(broken);
  }
}
