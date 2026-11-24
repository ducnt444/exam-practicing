import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnswerKey, Status } from '../components.jsx';
import { withId } from '../questions.js';
import { useFetch } from '../useFetch.js';

const addIds = (stats) => stats.map((s) => ({ ...s, question: withId(s.question) }));

export default function Stats() {
  const { data, error, loading } = useFetch('/stats', addIds);
  const [exam, setExam] = useState('');
  const exams = [...new Map(data?.map((s) => [s.examId, s.examTitle]))];
  const shown = data?.filter((s) => !exam || s.examId === exam);

  return (
    <>
      <h1>Most failed questions</h1>
      <Status loading={loading} error={error} />
      {data?.length === 0 && <p>Nothing failed so far. Questions you get wrong in finished tests will show up here. <Link to="/">Start a test</Link>.</p>}
      {data?.length > 0 && (
        <>
          {exams.length > 1 && (
            <label className="inline">Exam
              <select value={exam} onChange={(e) => setExam(e.target.value)}>
                <option value="">All exams</option>
                {exams.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
              </select>
            </label>
          )}
          <ul className="list">
            {shown.map((s) => (
              <li key={s.question.id} className="stat">
                <div className="count"><strong>{s.failed}</strong><span className="muted">of {s.seen} failed</span></div>
                <div>
                  <h2>{s.question.question}</h2>
                  <p className="muted">{s.examTitle}. Last time: {s.lastCorrect ? 'correct' : 'wrong'}</p>
                  <details>
                    <summary>Show answer</summary>
                    <AnswerKey question={s.question} />
                  </details>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
