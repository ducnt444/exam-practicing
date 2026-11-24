import { createApp } from './app.js';
import { config } from './config.js';
import { migrate, openDb } from './db.js';
import { JsonQuestionRepository } from './questionRepository.js';

const questions = new JsonQuestionRepository(config.questionsPath);
await questions.listExams(); // fail at startup if the question file is invalid

const db = openDb({ connectionString: config.databaseUrl });
try {
  await migrate(db);
} catch (err) {
  console.error('Cannot set up Postgres. Is it running? Try: npm run db');
  throw err;
}

createApp({ db, questions }).listen(config.port, config.host, (err) => {
  if (err) throw err;
  console.log(`API listening on http://${config.host}:${config.port}`);
});
