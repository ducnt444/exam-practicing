// Display-only id, new on every load. randomUUID is missing on plain-HTTP, non-localhost pages.
const randomId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const withId = (question) => ({ ...question, id: randomId() });

/** For finished tests, where the options say which are correct. */
export const questionType = (q) => (q.options.filter((o) => o.isCorrect).length > 1 ? 'multiple' : 'single');
