import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

/** "multiple" when more than one option is correct, otherwise "single". */
export const questionType = (q) => (q.options.filter((o) => o.isCorrect).length > 1 ? 'multiple' : 'single');

// Questions have no id in the file, so stats recognise one by its wording. The order
// of options and which are correct don't matter, so fixing an answer keeps its stats.
export function fingerprint(q) {
  const content = [q.question.trim(), ...q.options.map((o) => o.text.trim()).sort()];
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 32);
}

/**
 * The only module that knows where questions are stored. To move to a database,
 * write another class with these same async methods and swap it in index.js:
 *   listExams()               -> [{ id, title, description, questionCount }]
 *   getExam(examId)           -> { id, title, description } | null
 *   listQuestionIds(examId)   -> [id]
 *   getQuestion(examId, id)   -> { question, options, explanation } | null
 *                                where options is [{ key, text, isCorrect }]
 */
export class JsonQuestionRepository {
  #path;
  #mtime = null;
  #exams = null;

  constructor(path) {
    this.#path = path;
  }

  // Re-reads the file when it changes, so questions can be edited without a restart.
  async #load() {
    const { mtimeMs } = await stat(this.#path);
    if (mtimeMs !== this.#mtime) {
      const data = JSON.parse(await readFile(this.#path, 'utf8'));
      validate(data);
      this.#exams = data.exams.map((e) => ({
        ...e, byId: new Map(e.questions.map((q) => [fingerprint(q), q])),
      }));
      this.#mtime = mtimeMs;
    }
    return this.#exams;
  }

  async #find(examId) {
    return (await this.#load()).find((e) => e.id === examId) ?? null;
  }

  async listExams() {
    return (await this.#load()).map(({ id, title, description, questions }) => ({
      id, title, description, questionCount: questions.length,
    }));
  }

  async getExam(examId) {
    const exam = await this.#find(examId);
    return exam && { id: exam.id, title: exam.title, description: exam.description };
  }

  async listQuestionIds(examId) {
    return [...((await this.#find(examId))?.byId.keys() ?? [])];
  }

  async getQuestion(examId, id) {
    return (await this.#find(examId))?.byId.get(id) ?? null;
  }
}

export function validate(data) {
  const fail = (msg) => { throw new Error(`Invalid question file: ${msg}`); };
  const unique = (list) => new Set(list).size === list.length;
  const str = (v) => typeof v === 'string' && v.trim() !== '';

  if (!Array.isArray(data?.exams)) fail('"exams" must be an array');
  if (!unique(data.exams.map((e) => e.id))) fail('duplicate exam id');
  for (const exam of data.exams) {
    if (!str(exam.id) || !str(exam.title)) fail('each exam needs an id and a title');
    if (!Array.isArray(exam.questions) || !exam.questions.length) fail(`${exam.id}: no questions`);
    const seen = new Map();
    for (const [i, q] of exam.questions.entries()) {
      const at = `${exam.id}, question ${i + 1}`;
      if (!str(q?.question)) fail(`${at}: needs a question`);
      if (!Array.isArray(q.options) || q.options.length !== 4) fail(`${at}: needs exactly 4 options`);
      if (!q.options.every((o) => str(o?.key) && str(o?.text) && typeof o.isCorrect === 'boolean')) {
        fail(`${at}: each option needs a key, text and a true/false isCorrect`);
      }
      if (!unique(q.options.map((o) => o.key))) fail(`${at}: duplicate option key`);
      if (!q.options.some((o) => o.isCorrect)) fail(`${at}: needs at least one correct option`);
      const id = fingerprint(q);
      if (seen.has(id)) fail(`${at}: same question and options as question ${seen.get(id)}`);
      seen.set(id, i + 1);
    }
  }
}
