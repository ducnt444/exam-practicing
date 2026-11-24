import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { migrate, openDb } from '../src/db.js';
import { fingerprint, JsonQuestionRepository, validate } from '../src/questionRepository.js';

const fixture = fileURLToPath(new URL('./fixture.json', import.meta.url));
const bank = JSON.parse(readFileSync(fixture, 'utf8'));
const examId = bank.exams[0].id;
const key = new Map(bank.exams[0].questions.map((q) => [q.question, q]));
// Every run gets its own schema, so real data is never touched.
const schema = `test_${process.pid}_${Date.now()}`;
let server, base, db;

before(async () => {
  db = openDb({ connectionString: config.databaseUrl, options: `-c search_path=${schema}` });
  await db.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
  const app = createApp({ db, questions: new JsonQuestionRepository(fixture) });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.closeAllConnections();
  server?.close();
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await db.end();
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

async function user(username) {
  const call = client();
  assert.equal((await call('POST', '/auth/register', { username, password: 'password1' })).status, 201);
  return call;
}

test('auth: duplicate, wrong password, logout, anonymous', async () => {
  const call = await user('alice');
  const login = (username, password) => client()('POST', '/auth/login', { username, password });
  assert.equal((await client()('POST', '/auth/register', { username: 'ALICE', password: 'password1' })).status, 409);
  assert.equal((await login('alice', 'nope')).status, 401);
  assert.equal((await login('a\u0000b', 'nope')).status, 401);
  assert.equal((await login('Alice', 'password1')).status, 200);
  assert.equal((await client()('GET', '/exams')).status, 401);
  await call('POST', '/auth/logout');
  assert.equal((await call('GET', '/auth/me')).status, 401);
});

test('login is rate limited', async () => {
  const call = client();
  const tries = await Promise.all(Array.from({ length: 12 }, () =>
    call('POST', '/auth/login', { username: 'ghost', password: 'x' })));
  assert.equal(tries.filter((t) => t.status === 429).length, 2);
});

test('full test: hides answers, grades, logs, counts failures', async () => {
  const call = await user('bob');
  const other = await user('carol');
  const { body: attempt } = await call('POST', '/attempts', { examId });
  let wrong = null;
  for (let p = 1; p <= attempt.total; p++) {
    const url = `/attempts/${attempt.id}/questions/${p}`;
    const { body: q } = await call('GET', url);
    assert.deepEqual(Object.keys(q).sort(), ['options', 'position', 'question', 'selected', 'type']);
    for (const o of q.options) assert.deepEqual(Object.keys(o).sort(), ['key', 'text']);
    const { options } = key.get(q.question);
    const { type } = q;
    const correct = options.filter((o) => o.isCorrect).map((o) => o.key);
    assert.equal(type, correct.length > 1 ? 'multiple' : 'single');
    // Miss one multiple-choice question by answering it only partially.
    const partial = !wrong && type === 'multiple';
    if (partial) wrong = q.question;
    const selected = partial ? correct.slice(1) : [...correct].reverse();
    const submit = (keys, as = call) => as('POST', `${url}/submit`, { selected: keys });
    assert.equal((await submit([])).status, 400);
    assert.equal((await submit(['nope'])).status, 400);
    assert.equal((await submit(selected, other)).status, 404);
    if (type === 'single') {
      assert.equal((await submit(options.slice(0, 2).map((o) => o.key))).status, 400);
    }
    const tries = await Promise.all([submit(selected), submit(selected)]);
    assert.deepEqual(tries.map((t) => t.status).sort(), [200, 409]);
    const graded = tries.find((t) => t.status === 200).body;
    assert.equal(graded.isCorrect, !partial);
    assert.deepEqual(graded.options, options);
    assert.deepEqual((await call('GET', url)).body, graded);
    assert.equal((await other('GET', url)).status, 404);
  }
  const { results } = (await call('GET', '/attempts/active')).body;
  assert.deepEqual(results.filter((r) => !r), [false]);
  assert.ok(wrong, 'the first exam needs a multiple-choice question');
  assert.deepEqual((await call('GET', '/history')).body, []);
  const finishes = await Promise.all([1, 2].map(() => call('POST', `/attempts/${attempt.id}/finish`)));
  assert.deepEqual(finishes.map((f) => f.status).sort(), [200, 409]);
  assert.equal(finishes.find((f) => f.status === 200).body.correct, attempt.total - 1);
  assert.equal((await call('DELETE', `/attempts/${attempt.id}`)).status, 409);
  assert.equal((await call('GET', '/history')).body.length, 1);
  assert.equal((await call('GET', `/history/${attempt.id}`)).body.questions.length, attempt.total);
  assert.equal((await call('GET', '/history/abc')).status, 404);

  const stats = (await call('GET', '/stats')).body;
  assert.equal(stats.length, 1);
  assert.equal(stats[0].question.question, wrong);
  assert.deepEqual([stats[0].failed, stats[0].seen], [1, 1]);

  assert.deepEqual((await other('GET', '/history')).body, []);
  assert.deepEqual((await other('GET', '/stats')).body, []);
  assert.equal((await other('GET', `/history/${attempt.id}`)).status, 404);

  const second = (await call('POST', '/attempts', { examId })).body;
  await call('POST', `/attempts/${second.id}/finish`); // all unanswered: all failed
  const later = (await call('GET', '/stats')).body;
  assert.equal(later.length, attempt.total);
  assert.equal(later[0].question.question, wrong);
  assert.deepEqual([later[0].failed, later[0].seen], [2, 2]);
});

test('quit or replaced tests leave no trace', async () => {
  const call = await user('dave');
  const one = (await call('POST', '/attempts', { examId, count: 2 })).body;
  assert.equal(one.total, 2);
  const starts = await Promise.all([1, 2].map(() => call('POST', '/attempts', { examId })));
  assert.deepEqual(starts.map((s) => s.status), [201, 201]);
  assert.equal((await call('GET', `/attempts/${one.id}`)).status, 404);
  const active = (await call('GET', '/attempts/active')).body;
  assert.equal((await call('DELETE', `/attempts/${active.id}`)).status, 204);
  assert.equal((await call('GET', '/attempts/active')).body, null);
  assert.deepEqual((await call('GET', '/history')).body, []);
  assert.deepEqual((await call('GET', '/stats')).body, []);
});

test('question file validation', () => {
  const bad = structuredClone(bank);
  bad.exams[0].questions[0].options.pop();
  assert.throws(() => validate(bad), /exactly 4 options/);

  const none = structuredClone(bank);
  none.exams[0].questions[0].options.forEach((o) => { o.isCorrect = false; });
  assert.throws(() => validate(none), /at least one correct/);

  const twice = structuredClone(bank);
  twice.exams[0].questions.push(twice.exams[0].questions[0]);
  assert.throws(() => validate(twice), /same question and options/);
});

test('fingerprint survives answer fixes and reordering, not rewording', () => {
  const q = bank.exams[0].questions[0];
  const fixed = structuredClone(q);
  fixed.options.reverse().forEach((o) => { o.isCorrect = !o.isCorrect; });
  assert.equal(fingerprint(fixed), fingerprint(q));
  assert.notEqual(fingerprint({ ...q, question: 'Other?' }), fingerprint(q));
});
