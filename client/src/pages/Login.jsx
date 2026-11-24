import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const creating = mode === 'register';

  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.post(`/auth/${mode}`, {
        username: form.get('username'),
        password: form.get('password'),
      }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>Exam Practice</h1>
      <form onSubmit={submit} className="panel">
        <label>Username
          <input name="username" autoComplete="username" required autoFocus maxLength={30} />
        </label>
        <label>Password
          <input name="password" type="password" required maxLength={200}
            minLength={creating ? 8 : undefined}
            autoComplete={creating ? 'new-password' : 'current-password'} />
          {creating && <span className="muted">At least 8 characters</span>}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{creating ? 'Create account' : 'Log in'}</button>
        <button type="button" className="quiet" disabled={busy}
          onClick={() => { setMode(creating ? 'login' : 'register'); setError(null); }}>
          {creating ? 'I already have an account' : 'Create an account'}
        </button>
      </form>
    </main>
  );
}
