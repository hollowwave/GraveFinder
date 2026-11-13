const KEY = 'gf_admin';

export const auth = {
  get: () => JSON.parse(sessionStorage.getItem(KEY) || 'null'),
  set: (v) => sessionStorage.setItem(KEY, JSON.stringify(v)),
  clear: () => sessionStorage.removeItem(KEY),
};

export async function api(path, opts = {}) {
  const a = auth.get();
  const res = await fetch('/api' + path, {
    method: opts.method,
    headers: { 'Content-Type': 'application/json', ...(a ? { Authorization: 'Bearer ' + a.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    auth.clear();
    location.reload();
  }
  if (!res.ok) {
    const e = new Error(data.error || 'Request failed');
    e.errors = data.errors;
    throw e;
  }
  return data;
}

export const show = (v) => v || '—';
export const gravePath = (r) => (r.grave_number ? `Section ${r.section}, block ${r.block}, row ${r.row}, ${r.grave_number}` : 'Unassigned');
