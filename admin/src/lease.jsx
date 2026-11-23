export const STATES = {
  available: { fill: '#ffffff', stroke: '#2f5d50', label: 'Available' },
  paid: { fill: '#2f5d50', stroke: '#2f5d50', label: 'Occupied, lease paid' },
  provisional: { fill: '#3b6fb6', stroke: '#264a7d', label: 'Provisional (field-assigned)' },
  unpaid: { fill: '#8c3b34', stroke: '#8c3b34', label: 'Occupied, lease unpaid' },
  due: { fill: '#d9712b', stroke: '#9a4a0f', label: 'Lease due in 90 days' },
  expired: { fill: '#4a4a4a', stroke: '#222222', label: 'Lease expired' },
};

export function graveState(g) {
  if (g.status !== 'occupied') return 'available';
  if (g.lease_flag === 'expired') return 'expired';
  if (g.lease_status === 'unpaid') return 'unpaid';
  if (g.lease_status === 'provisional') return 'provisional';
  if (g.lease_flag === 'due_soon') return 'due';
  return 'paid';
}

export const plus5 = (s) => String(+s.slice(0, 4) + 5) + s.slice(4).replace('-02-29', '-02-28');

export function LeaseBadge({ r }) {
  return (
    <>
      <span className={`badge ${r.lease_status}`}>{r.lease_status}</span>
      {r.lease_flag && <span className={`badge ${r.lease_flag}`}>{r.lease_flag === 'due_soon' ? 'due soon' : 'expired'}</span>}
      {r.lease_end && <div className="muted nw">until {r.lease_end}</div>}
    </>
  );
}