import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { AnswerKey, Confirm, letter, Status } from '../components.jsx';
import { withId } from '../questions.js';
import { useFetch } from '../useFetch.js';

export default function Test() {
  const { id } = useParams();
  const { data, error, loading } = useFetch(`/attempts/${id}`);
  if (loading || error) return <Status loading={loading} error={error} />;
  return <Runner key={id} attempt={data} />;
}

function Runner({ attempt }) {
  const navigate = useNavigate();
  const { id, total } = attempt;
  const [results, setResults] = useState(attempt.results); // true, false, or null if not submitted
  const [position, setPosition] = useState(() => {
    const first = attempt.results.indexOf(null);
    return first === -1 ? 1 : first + 1;
  });
  const [question, setQuestion] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'quit' | 'finish'
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  const drafts = useRef(new Map()); // position -> choice not submitted yet

  useEffect(() => {
    let live = true;
    setQuestion(null);
    (async () => {
      try {
        const q = await api.get(`/attempts/${id}/questions/${position}`);
        if (!live) return;
        const draft = drafts.current.get(position);
        const submitted = q.isCorrect !== undefined;
        setQuestion(withId(draft && !submitted ? { ...q, selected: draft } : q));
        setResults((r) => r.with(position - 1, q.isCorrect ?? null));
        setError(null);
      } catch (err) {
        if (live) setError(err);
      }
    })();
    return () => { live = false; };
  }, [id, position, retry]);

  function choose(key) {
    const { type, selected: old } = question;
    const selected = type === 'single' ? [key]
      : old.includes(key) ? old.filter((s) => s !== key) : [...old, key];
    setQuestion({ ...question, selected });
    drafts.current.set(position, selected);
  }

  async function submit() {
    setBusy(true);
    try {
      const graded = await api.post(`/attempts/${id}/questions/${position}/submit`, { selected: question.selected });
      setQuestion(withId(graded));
      setResults((r) => r.with(position - 1, graded.isCorrect));
      setError(null);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  async function end(action, destination) {
    setBusy(true);
    try {
      await action();
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err);
      setDialog(null);
      setBusy(false);
    }
  }

  const finish = () => end(() => api.post(`/attempts/${id}/finish`), `/history/${id}`);

  const quit = () => end(() => api.del(`/attempts/${id}`), '/');

  const submitted = question?.isCorrect !== undefined;
  const left = results.filter((r) => r === null).length;

  return (
    <div className="test">
      <section className="paper">
        <div className="paper-head">
          <span>{attempt.examTitle}</span>
          <span className="muted">Question {position} of {total}</span>
        </div>
        {error && (
          <div className="error row" role="alert">
            <span>{error.message}</span>
            <button onClick={() => setRetry((r) => r + 1)}>Try again</button>
          </div>
        )}
        {!question && !error && <p className="muted" role="status">Loading…</p>}
        {question && !submitted && (
          <fieldset key={question.id} disabled={busy}>
            <legend>{question.question}</legend>
            <p className="muted">{question.type === 'single' ? 'Choose one answer' : 'Choose all answers that apply'}</p>
            <div className="options">
              {question.options.map((o, i) => (
                <label key={o.key} className="option pick">
                  <input type={question.type === 'single' ? 'radio' : 'checkbox'} name="answer"
                    checked={question.selected.includes(o.key)} onChange={() => choose(o.key)} />
                  <span className={`bubble ${question.type}`} aria-hidden="true">{letter(i)}</span>
                  <span className="option-text">{o.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {submitted && (
          <div key={question.id}>
            <h2 className="question">{question.question}</h2>
            <AnswerKey question={question} selected={question.selected} />
          </div>
        )}
        <p className="sr-only" role="status">{submitted ? (question.isCorrect ? 'Correct' : 'Wrong') : ''}</p>
        <div className="row between">
          <button disabled={busy || position === 1} onClick={() => setPosition(position - 1)}>Previous</button>
          {!submitted && (
            <button key="submit" className="primary" disabled={busy || !question?.selected.length} onClick={submit}>Submit</button>
          )}
          {/* e.detail > 1 is the second half of a double-click on Submit: don't skip the result. */}
          {submitted && position < total && (
            <button key="next" className="primary" autoFocus
              onClick={(e) => { if (e.detail < 2) setPosition(position + 1); }}>Next</button>
          )}
          {submitted && position === total && (
            <button key="finish" className="primary" autoFocus
              onClick={(e) => { if (e.detail < 2) setDialog('finish'); }}>Finish test</button>
          )}
        </div>
      </section>

      <aside className="sheet" aria-label="Answer sheet">
        <p>{total - left} of {total} answered, {results.filter(Boolean).length} correct</p>
        <div className="sheet-grid">
          {results.map((result, i) => (
            <button key={i} className={`bubble ${result === null ? '' : result ? 'filled' : 'missed'}`}
              aria-current={position === i + 1 ? 'step' : undefined}
              aria-label={`Question ${i + 1}, ${result === null ? 'not answered' : result ? 'correct' : 'wrong'}`}
              disabled={busy} onClick={() => setPosition(i + 1)}>{i + 1}</button>
          ))}
        </div>
        <button onClick={() => setDialog('finish')}>Finish test</button>
        <button className="quiet danger-text" onClick={() => setDialog('quit')}>Quit test</button>
      </aside>

      {dialog === 'finish' && (
        <Confirm title="Finish this test?" action="Finish test" busy={busy} onConfirm={finish} onCancel={() => setDialog(null)}>
          {left ? `${left} ${left === 1 ? 'question is' : 'questions are'} unanswered and will be marked wrong.`
            : 'You answered every question.'}
        </Confirm>
      )}
      {dialog === 'quit' && (
        <Confirm title="Quit this test?" action="Quit test" danger busy={busy} onConfirm={quit} onCancel={() => setDialog(null)}>
          Your answers will be deleted and nothing will be added to your history.
        </Confirm>
      )}
    </div>
  );
}
