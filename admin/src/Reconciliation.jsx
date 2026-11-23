import { Fragment, useEffect, useState, useCallback } from 'react';
import { api, show, gravePath } from './api';
import { LeaseBadge, plus5 } from './lease';

const TABS = [['all', 'Needs attention'], ['provisional', 'Provisional'], ['unpaid', 'Unpaid'], ['expired', 'Expired'], ['due', 'Due in 90 days']];
const catOf = (r) => (r.lease_status === 'provisional' ? 'provisional' : r.lease_status === 'unpaid' ? 'unpaid' : r.lease_flag === 'expired' ? 'expired' : 'due');

function LeaseForm({ r, mode, onClose, onSaved }) {
  const today = new Date().toLocaleDateString('en-CA');
  const [f, setF] = useState({ lessee: r.lessee_name || '', op: r.order_of_payment_no || '', or: '', amount: r.amount ?? '', paid: today });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const renew = mode === 'renew';
  // New lease runs 5 years from the old end date (renewal) or from burial/payment date (first payment).
  const start = renew ? r.lease_end || f.paid : r.lease_start || r.burial_date || f.paid;

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    try {
      const body = mode === 'encode'
        ? { lease_status: 'unpaid', lessee_name: f.lessee }
        : {
            lessee_name: f.lessee, lease_status: 'paid', order_of_payment_no: f.op, official_receipt_no: f.or,
            amount: f.amount, paid_date: f.paid, lease_start: start, lease_end: plus5(start),
          };
      await api(`/records/${r.id}/lease`, { method: 'PUT', body });
      onSaved(mode === 'encode' ? `${r.full_name} encoded; payment still pending` : renew ? `Renewal recorded for ${r.full_name}` : `Payment confirmed for ${r.full_name}`);
    } catch (ex) {
      setErr(ex.errors || { form: ex.message });
    } finally {
      setBusy(false);
    }
  };
  const e = (k) => err[k] && <span className="error">{err[k]}</span>;

  return (
    <form onSubmit={submit} className="inline" noValidate>
      <label>Lessee name<input value={f.lessee} onChange={set('lessee')} autoFocus />{e('lessee_name')}</label>
      {mode !== 'encode' && (
        <>
          <label>Order of Payment no.<input value={f.op} onChange={set('op')} />{e('order_of_payment_no')}</label>
          <label>Official Receipt no.<input value={f.or} onChange={set('or')} />{e('official_receipt_no')}</label>
          <label>Amount<input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} />{e('amount')}</label>
          <label>Paid date<input type="date" value={f.paid} onChange={set('paid')} />{e('paid_date')}</label>
          <span className="muted">New lease: {start} to {plus5(start)}</span>
        </>
      )}
      {err.form && <span className="error">{err.form}</span>}
      <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      <button disabled={busy}>{mode === 'encode' ? 'Mark encoded' : renew ? 'Record renewal' : 'Confirm payment'}</button>
    </form>
  );
}

export default function Reconciliation() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('all');
  const [open, setOpen] = useState(null); // { id, mode }
  const [notice, setNotice] = useState('');

  const load = useCallback(() => api('/reconciliation').then(setData), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;

  const { summary, rows } = data;
  const list = rows.filter((r) => tab === 'all' || catOf(r) === tab);
  const facts = [
    ['Occupied but not paid', summary.occupiedUnpaid],
    ['Provisional (field)', summary.provisional],
    ['Unpaid', summary.unpaid],
    ['Expired', summary.expired],
    ['Due in 90 days', summary.dueSoon],
  ];
  const saved = (m) => { setNotice(m); setOpen(null); load(); };
  const toggle = (id, mode) => setOpen(open && open.id === id && open.mode === mode ? null : { id, mode });

  return (
    <>
      <header className="pagehead"><h1>Lease reconciliation</h1></header>
      <p className="muted">Compare the cemetery records against the Treasurer's receipts. Enter the Official Receipt number once the family has paid.</p>
      <dl className="facts">
        {facts.map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}
      </dl>
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : 'secondary'} onClick={() => setTab(k)}>
            {label} ({k === 'all' ? rows.length : rows.filter((r) => catOf(r) === k).length})
          </button>
        ))}
        {notice && <span className="notice">{notice}</span>}
      </div>
      <table>
        <thead><tr><th>Name</th><th>Lessee</th><th>Location</th><th>Buried</th><th>Lease</th><th>Receipt</th><th>Source</th><th></th></tr></thead>
        <tbody>
          {list.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>{r.full_name}</td>
                <td>{show(r.lessee_name)}</td>
                <td>{gravePath(r)}</td>
                <td className="nw">{show(r.burial_date)}</td>
                <td><LeaseBadge r={r} /></td>
                <td>{show(r.official_receipt_no)}</td>
                <td>{r.assigned_via === 'field' ? 'Field worker' : 'Office'}</td>
                <td className="rowactions">
                  {r.lease_status === 'provisional' && <button className="link" onClick={() => toggle(r.id, 'encode')}>Mark encoded</button>}
                  <button className="link" onClick={() => toggle(r.id, r.lease_status === 'paid' ? 'renew' : 'pay')}>
                    {r.lease_status === 'paid' ? 'Renew' : 'Confirm payment'}
                  </button>
                </td>
              </tr>
              {open && open.id === r.id && (
                <tr><td colSpan="8"><LeaseForm r={r} mode={open.mode} onClose={() => setOpen(null)} onSaved={saved} /></td></tr>
              )}
            </Fragment>
          ))}
          {!list.length && <tr><td colSpan="8" className="empty">Nothing to reconcile in this view.</td></tr>}
        </tbody>
      </table>
    </>
  );
}