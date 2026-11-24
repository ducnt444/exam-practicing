import { fileURLToPath } from 'node:url';

// Defaults match docker-compose.yml.
export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://exam:exam@127.0.0.1:5433/exam',
  questionsPath: process.env.QUESTIONS_PATH
    ?? fileURLToPath(new URL('../data/questions.json', import.meta.url)),
};
