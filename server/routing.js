// Walking-route helpers for the road network drawn in the admin "Cemetery
// paths" editor. The graph is tiny (a cemetery has, at most, a few hundred
// path points) so a plain O(V^2) Dijkstra is instant here; there is no need
// for a binary heap at this scale.

const R_EARTH = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

// Straight-line distance in meters between two {latitude, longitude} points.
function haversine(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

// The road node closest to an arbitrary point, e.g. a visitor's GPS fix or a
// grave that isn't exactly on the path network.
function nearestNode(nodes, point) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const d = haversine(node, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = node;
    }
  }
  return best ? { node: best, distance: bestDistance } : null;
}

// Shortest path between two road nodes. Returns { distance, nodeIds } or null
// if the graph does not connect them (e.g. two separate path networks).
function shortestPath(nodes, edges, startId, endId) {
  if (startId === endId) return { distance: 0, nodeIds: [startId] };

  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  edges.forEach((e) => {
    const w = haversine(byId.get(e.a), byId.get(e.b));
    adjacency.get(e.a).push({ to: e.b, w });
    adjacency.get(e.b).push({ to: e.a, w });
  });

  const dist = new Map(nodes.map((n) => [n.id, Infinity]));
  const prev = new Map();
  const visited = new Set();
  dist.set(startId, 0);

  while (visited.size < nodes.length) {
    let u = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        u = id;
      }
    }
    if (u === null) break; // everything left is unreachable
    visited.add(u);
    if (u === endId) break;
    for (const { to, w } of adjacency.get(u)) {
      if (visited.has(to)) continue;
      const alt = dist.get(u) + w;
      if (alt < dist.get(to)) {
        dist.set(to, alt);
        prev.set(to, u);
      }
    }
  }

  if (dist.get(endId) === Infinity) return null;
  const nodeIds = [endId];
  let cur = endId;
  while (cur !== startId) {
    cur = prev.get(cur);
    if (cur === undefined) return null;
    nodeIds.push(cur);
  }
  nodeIds.reverse();
  return { distance: dist.get(endId), nodeIds };
}

// Build a walking route from `from` to `to` ({latitude, longitude} points)
// over the given road graph ({nodes, edges}). Snaps each end to its nearest
// road point and routes between them. Falls back to a direct straight line
// when there is no road network yet, or no connected path between the ends
// (e.g. two disconnected clusters of paths) — the mobile app still needs
// something to draw in that case.
function buildRoute(roads, from, to) {
  const { nodes, edges } = roads;
  if (!nodes.length) return { distance_m: Math.round(haversine(from, to)), points: [from, to], on_road: false };

  const start = nearestNode(nodes, from);
  const end = nearestNode(nodes, to);
  const path = shortestPath(nodes, edges, start.node.id, end.node.id);
  if (!path) return { distance_m: Math.round(haversine(from, to)), points: [from, to], on_road: false };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const points = [from, ...path.nodeIds.map((id) => byId.get(id)), to];
  // Drop consecutive points that sit on top of each other (e.g. `from` is
  // already right at its nearest node) so the line doesn't double back.
  const deduped = points.filter((p, i) => i === 0 || haversine(p, points[i - 1]) > 0.5);

  return { distance_m: Math.round(start.distance + path.distance + end.distance), points: deduped, on_road: true };
}

module.exports = { haversine, nearestNode, shortestPath, buildRoute };
