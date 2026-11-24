import { useEffect, useRef } from 'react';
import { questionType } from './questions.js';

export function Status({ loading, error }) {
  if (error) return <p className="error" role="alert">{error.message}</p>;
  if (loading) return <p className="muted" role="status">Loading…</p>;
  return null;
}

export function Confirm({ title, children, action, danger, busy, onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return (
    <dialog ref={ref} aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id="confirm-title">{title}</h2>
      <p>{children}</p>
      <div className="row end">
        <button onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>{action}</button>
      </div>
    </dialog>
  );
}

export const letter = (i) => 'ABCD'[i];

/** Read-only options. Marks the answer key, and the user's picks if given. */
export function AnswerKey({ question, selected }) {
  const type = questionType(question);
  return (
    <>
      <ul className="options">
        {question.options.map((o, i) => {
          const right = o.isCorrect;
          const picked = selected?.includes(o.key);
          const note = [picked && 'your answer', right && 'correct'].filter(Boolean).join(', ');
          return (
            <li key={o.key} className={`option ${right ? 'right' : picked ? 'wrong' : ''}`}>
              <span className={`bubble ${type} ${picked || (!selected && right) ? 'filled' : ''}`}>{letter(i)}</span>
              <span className="option-text">{o.text}</span>
              {note && <span className="sr-only">{note}</span>}
            </li>
          );
        })}
      </ul>
      {question.explanation && <p className="muted">{question.explanation}</p>}
    </>
  );
}
