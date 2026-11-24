import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Confirm, Status } from '../components.jsx';

export default function Home() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // start waiting on "discard current test?"

  useEffect(() => {
    let live = true;
    Promise.all([api.get('/exams'), api.get('/attempts/active')]).then(
      ([exams, active]) => live && setData({ exams, active }),
      (err) => live && setError(err),
    );
    return () => { live = false; };
  }, []);

  async function start(request) {
    setBusy(true);
    try {
      const attempt = await api.post('/attempts', request);
      navigate(`/test/${attempt.id}`);
    } catch (err) {
      setError(err);
      setPending(null);
      setBusy(false);
    }
  }

  function submit(e, examId) {
    e.preventDefault();
    const request = { examId, count: Number(new FormData(e.currentTarget).get('count')) };
    if (data.active) setPending(request);
    else start(request);
  }

  const active = data?.active;
  return (
    <>
      <h1>Choose an exam</h1>
      <Status loading={!data && !error} error={error} />
      {active && (
        <section className="panel resume">
          <div>
            <strong>{active.examTitle}</strong> is still in progress
            <div className="muted">{active.results.filter((r) => r !== null).length} of {active.total} answered</div>
          </div>
          <Link className="button primary" to={`/test/${active.id}`}>Resume test</Link>
        </section>
      )}
      {data && (
        <ul className="list">
          {data.exams.map((exam) => (
            <li key={exam.id} className="exam">
              <div>
                <h2>{exam.title}</h2>
                <p className="muted">{exam.description}</p>
              </div>
              <form className="row" onSubmit={(e) => submit(e, exam.id)}>
                <label className="inline">
                  Questions
                  <input name="count" type="number" required min={1} max={exam.questionCount} defaultValue={exam.questionCount} />
                  <span className="muted">of {exam.questionCount}</span>
                </label>
                <button className={active ? '' : 'primary'} disabled={busy}>Start test</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {pending && (
        <Confirm title="Discard your current test?" action="Discard and start" danger busy={busy}
          onConfirm={() => start(pending)} onCancel={() => setPending(null)}>
          {active.examTitle} is unfinished. It will not be added to your history.
        </Confirm>
      )}
    </>
  );
}
