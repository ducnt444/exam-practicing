import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { transaction } from './db.js';
import { HttpError } from './httpError.js';
import { questionType } from './questionRepository.js';

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// All correct options and nothing else.
const isCorrect = (selected, options) =>
  options.every((o) => o.isCorrect === selected.includes(o.key));

const summary = (a) => ({
  id: a.id,
  examId: a.exam_id,
  examTitle: a.exam_title,
  total: a.total,
  correct: a.correct_count,
  startedAt: a.started_at,
  finishedAt: a.finished_at,
});

function checkActive(attempt) {
  if (!attempt) throw new HttpError(404, 'This test no longer exists.');
  if (attempt.finished_at) throw new HttpError(409, 'This test is already finished.');
  return attempt;
}

const findAttempt = async (conn, req, lock = '') =>
  (await conn.query(`SELECT * FROM attempts WHERE id = $1 AND user_id = $2 ${lock}`,
    [req.params.id, req.user.id])).rows[0];

const questionsOf = async (conn, attemptId) =>
  (await conn.query('SELECT * FROM attempt_questions WHERE attempt_id = $1 ORDER BY position',
    [attemptId])).rows;

async function findQuestion(conn, attempt, req) {
  const { rows } = await conn.query(
    'SELECT * FROM attempt_questions WHERE attempt_id = $1 AND position = $2',
    [attempt.id, req.params.position]);
  if (!rows[0]) throw new HttpError(404, 'Question not found.');
  return rows[0];
}

const withProgress = async (conn, a) => ({
  ...summary(a),
  // Per question: true = correct, false = wrong, null = not submitted yet.
  results: (await questionsOf(conn, a.id)).map((r) => r.is_correct),
});

// The answer key is included only once the question has been submitted.
function questionView(row) {
  const { question, options, explanation } = row.snapshot;
  const submitted = row.is_correct !== null;
  return {
    position: row.position,
    type: questionType(row.snapshot),
    question,
    options: submitted ? options : options.map(({ key, text }) => ({ key, text })),
    selected: row.selected,
    ...(submitted && { isCorrect: row.is_correct, explanation }),
  };
}

export function attemptRoutes(db, questions) {
  const router = Router();

  for (const name of ['id', 'position']) {
    router.param(name, (req, res, next, value) => {
      if (!/^\d{1,9}$/.test(value)) throw new HttpError(404, 'Not found.');
      next();
    });
  }

  // Locks the attempt so answering, finishing and quitting cannot interleave.
  const onActive = (req, fn) => transaction(db, async (tx) =>
    fn(tx, checkActive(await findAttempt(tx, req, 'FOR UPDATE'))));

  router.get('/exams', async (req, res) => res.json(await questions.listExams()));

  router.post('/attempts', async (req, res) => {
    const { examId, count } = req.body ?? {};
    const exam = await questions.getExam(examId);
    if (!exam) throw new HttpError(404, 'Exam not found.');
    let ids = shuffle(await questions.listQuestionIds(examId));
    if (count !== undefined) {
      if (!Number.isInteger(count) || count < 1) throw new HttpError(400, 'Choose at least one question.');
      ids = ids.slice(0, count);
    }
    const picked = await Promise.all(ids.map(async (id) => ({
      id, question: await questions.getQuestion(examId, id),
    })));

    const attempt = await transaction(db, async (tx) => {
      // Two simultaneous starts by one user take turns.
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      // An abandoned test is never logged.
      await tx.query('DELETE FROM attempts WHERE user_id = $1 AND finished_at IS NULL', [req.user.id]);
      const { rows: [row] } = await tx.query(`
        INSERT INTO attempts (user_id, exam_id, exam_title, total) VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.user.id, exam.id, exam.title, picked.length]);
      await tx.query(`
        INSERT INTO attempt_questions (attempt_id, position, question_id, snapshot)
        SELECT $1, n, q->>'id', q->'question' FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS t(q, n)`,
        [row.id, JSON.stringify(picked)]);
      return withProgress(tx, row);
    });
    res.status(201).json(attempt);
  });

  router.get('/attempts/active', async (req, res) => {
    const { rows: [attempt] } = await db.query(
      'SELECT * FROM attempts WHERE user_id = $1 AND finished_at IS NULL', [req.user.id]);
    res.json(attempt ? await withProgress(db, attempt) : null);
  });

  router.get('/attempts/:id', async (req, res) => {
    res.json(await withProgress(db, checkActive(await findAttempt(db, req))));
  });

  router.get('/attempts/:id/questions/:position', async (req, res) => {
    res.json(questionView(await findQuestion(db, checkActive(await findAttempt(db, req)), req)));
  });

  // Grades one question, reveals its answer and locks it.
  router.post('/attempts/:id/questions/:position/submit', async (req, res) => {
    const row = await onActive(req, async (tx, attempt) => {
      const { snapshot: q, position, is_correct: graded } = await findQuestion(tx, attempt, req);
      if (graded !== null) throw new HttpError(409, 'This question is already submitted.');
      const selected = req.body?.selected;
      const valid = Array.isArray(selected)
        && selected.length > 0
        && new Set(selected).size === selected.length
        && selected.every((s) => q.options.some((o) => o.key === s))
        && (questionType(q) === 'multiple' || selected.length === 1);
      if (!valid) throw new HttpError(400, 'Invalid answer.');
      const { rows } = await tx.query(`
        UPDATE attempt_questions SET selected = $1, is_correct = $2
        WHERE attempt_id = $3 AND position = $4 RETURNING *`,
        [JSON.stringify(selected), isCorrect(selected, q.options), attempt.id, position]);
      return rows[0];
    });
    res.json(questionView(row));
  });

  router.post('/attempts/:id/finish', async (req, res) => {
    const finished = await onActive(req, async (tx, attempt) => {
      await tx.query(`
        UPDATE attempt_questions SET selected = '[]', is_correct = false
        WHERE attempt_id = $1 AND is_correct IS NULL`, [attempt.id]);
      const { rows: [row] } = await tx.query(`
        UPDATE attempts SET finished_at = now(), correct_count =
          (SELECT COUNT(*) FROM attempt_questions WHERE attempt_id = $1 AND is_correct)
        WHERE id = $1 RETURNING *`, [attempt.id]);
      return row;
    });
    res.json(summary(finished));
  });

  router.delete('/attempts/:id', async (req, res) => {
    await onActive(req, (tx, attempt) => tx.query('DELETE FROM attempts WHERE id = $1', [attempt.id]));
    res.status(204).end();
  });

  router.get('/history', async (req, res) => {
    const { rows } = await db.query(`
      SELECT * FROM attempts WHERE user_id = $1 AND finished_at IS NOT NULL ORDER BY finished_at DESC`,
      [req.user.id]);
    res.json(rows.map(summary));
  });

  router.get('/history/:id', async (req, res) => {
    const attempt = await findAttempt(db, req);
    if (!attempt?.finished_at) throw new HttpError(404, 'Result not found.');
    res.json({
      ...summary(attempt),
      questions: (await questionsOf(db, attempt.id)).map((r) => ({
        ...r.snapshot,
        position: r.position,
        selected: r.selected,
        isCorrect: r.is_correct,
      })),
    });
  });

  router.get('/stats', async (req, res) => {
    const { rows } = await db.query(`
      WITH mine AS (
        SELECT a.exam_id, a.exam_title, q.question_id, q.snapshot, q.is_correct,
               (COUNT(*) OVER w)::int AS seen,
               (COUNT(*) FILTER (WHERE NOT q.is_correct) OVER w)::int AS failed,
               ROW_NUMBER() OVER (PARTITION BY a.exam_id, q.question_id ORDER BY a.id DESC) AS recency
        FROM attempts a JOIN attempt_questions q ON q.attempt_id = a.id
        WHERE a.user_id = $1 AND a.finished_at IS NOT NULL
        WINDOW w AS (PARTITION BY a.exam_id, q.question_id)
      )
      SELECT * FROM mine WHERE recency = 1 AND failed > 0
      ORDER BY failed DESC, failed * 1.0 / seen DESC, exam_id, question_id`, [req.user.id]);
    res.json(rows.map((r) => ({
      examId: r.exam_id,
      examTitle: r.exam_title,
      seen: r.seen,
      failed: r.failed,
      lastCorrect: r.is_correct,
      question: r.snapshot,
    })));
  });

  return router;
}
