import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnswerKey, Status } from '../components.jsx';
import { withId } from '../questions.js';
import { useFetch } from '../useFetch.js';

const addIds = (result) => ({ ...result, questions: result.questions.map(withId) });

export default function Result() {
  const { id } = useParams();
  const { data, error, loading } = useFetch(`/history/${id}`, addIds);
  const [wrongOnly, setWrongOnly] = useState(false);
  if (loading || error) return <Status loading={loading} error={error} />;

  const shown = data.questions.filter((q) => !wrongOnly || !q.isCorrect);
  return (
    <>
      <Link to="/history">All history</Link>
      <h1>{data.examTitle}</h1>
      <p className="score"><strong>{Math.round((100 * data.correct) / data.total)}%</strong> {data.correct} of {data.total} correct</p>
      <label className="check">
        <input type="checkbox" checked={wrongOnly} onChange={(e) => setWrongOnly(e.target.checked)} />
        Show only wrong answers
      </label>
      {shown.length === 0 && <p>No wrong answers in this test.</p>}
      <ol className="list">
        {shown.map((q) => (
          <li key={q.id}>
            <p className={q.isCorrect ? 'verdict ok' : 'verdict bad'}>
              Question {q.position}: {q.isCorrect ? 'correct' : q.selected.length ? 'wrong' : 'not answered'}
            </p>
            <h2>{q.question}</h2>
            <AnswerKey question={q} selected={q.selected} />
          </li>
        ))}
      </ol>
    </>
  );
}
