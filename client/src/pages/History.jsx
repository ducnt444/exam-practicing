import { Link } from 'react-router-dom';
import { Status } from '../components.jsx';
import { useFetch } from '../useFetch.js';

function duration(from, to) {
  const s = Math.round((new Date(to) - new Date(from)) / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export default function History() {
  const { data, error, loading } = useFetch('/history');
  return (
    <>
      <h1>History</h1>
      <Status loading={loading} error={error} />
      {data?.length === 0 && <p>No finished tests yet. <Link to="/">Start one</Link>.</p>}
      {data?.length > 0 && (
        <div className="scroll">
          <table>
            <thead><tr><th>Exam</th><th>Finished</th><th>Time taken</th><th className="num">Score</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/history/${a.id}`}>{a.examTitle}</Link></td>
                  <td>{new Date(a.finishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{duration(a.startedAt, a.finishedAt)}</td>
                  <td className="num">{a.correct}/{a.total} <span className="muted">({Math.round((100 * a.correct) / a.total)}%)</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
