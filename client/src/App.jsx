import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Test from './pages/Test.jsx';
import History from './pages/History.jsx';
import Result from './pages/Result.jsx';
import Stats from './pages/Stats.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined: not known yet
  const [error, setError] = useState(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get('/auth/me').then(setUser, (err) => {
      if (err.status === 401) setUser(null);
      else setError(err.message);
    });
  }, []);

  async function logout() {
    try {
      await api.post('/auth/logout');
      setError(null);
      setUser(null);
    } catch (err) {
      setError(err.message);
    }
  }

  if (user === undefined) return <main><p className={error ? 'error' : 'muted'} role="status">{error ?? 'Loading…'}</p></main>;
  if (!user) return <Login onLogin={(u) => { setError(null); setUser(u); }} />;

  return (
    <>
      <header className="top">
        <nav>
          <NavLink to="/" end>Exams</NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/stats">Stats</NavLink>
        </nav>
        <div className="account">
          <span className="muted">{user.username}</span>
          <button className="quiet" onClick={logout}>Log out</button>
        </div>
      </header>
      <main>
        {error && <p className="error" role="alert">{error}</p>}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/test/:id" element={<Test />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<Result />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
