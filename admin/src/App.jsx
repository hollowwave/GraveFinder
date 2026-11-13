import { useEffect, useState } from 'react';
import { api, auth, show, gravePath } from './api';
import Records from './Records';
import MapPage from './MapPage';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/login', { method: 'POST', body: { username, password } });
      auth.set(r);
      onLogin(r);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>GraveFinder admin</h1>
        <p className="muted">Hardin ng Alaala Memorial Park</p>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button>Log in</button>
        <p className="muted">Demo account: admin / admin123</p>
      </form>
    </main>
  );
}

function Overview({ go }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    api('/stats').then(setS);
  }, []);
  if (!s) return null;
  const facts = [
    ['Burial records', s.totalRecords],
    ['Occupied graves', s.occupiedGraves],
    ['Available graves', s.availableGraves],
    ['Sections', s.totalSections],
  ];
  return (
    <>
      <header className="pagehead"><h1>Overview</h1></header>
      <dl className="facts">
        {facts.map(([label, n]) => (
          <div key={label}><dt>{label}</dt><dd>{n}</dd></div>
        ))}
      </dl>
      <h2>Recently added</h2>
      <table>
        <thead><tr><th>Name</th><th>Died</th><th>Location</th><th>Added</th></tr></thead>
        <tbody>
          {s.recentRecords.map((r) => (
            <tr key={r.id}>
              <td>{r.full_name}</td>
              <td>{r.date_of_death}</td>
              <td>{gravePath(r)}</td>
              <td>{show(r.created_at?.slice(0, 10))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><button className="link" onClick={() => go('records')}>Manage all records</button></p>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(auth.get());
  const [page, setPage] = useState('overview');
  const [cemetery, setCemetery] = useState(null);

  useEffect(() => {
    if (user) api('/cemetery').then(setCemetery);
  }, [user]);

  if (!user) return <Login onLogin={setUser} />;

  const logout = () => {
    auth.clear();
    setUser(null);
    setCemetery(null);
  };
  const nav = [['overview', 'Overview'], ['records', 'Burial records'], ['map', 'Cemetery map']];

  return (
    <div className="shell">
      <nav className="rail">
        <strong>GraveFinder</strong>
        {nav.map(([k, label]) => (
          <button key={k} className={page === k ? 'active' : ''} onClick={() => setPage(k)}>{label}</button>
        ))}
        <span className="grow" />
        <span className="muted">{user.username}</span>
        <button onClick={logout}>Log out</button>
      </nav>
      <main className="content">
        {!cemetery ? <p className="muted">Loading cemetery…</p> : (
          <>
            {page === 'overview' && <Overview go={setPage} />}
            {page === 'records' && <Records cemetery={cemetery} />}
            {page === 'map' && <MapPage cemetery={cemetery} />}
          </>
        )}
      </main>
    </div>
  );
}
