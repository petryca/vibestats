export async function fetchStats(domain, days) {
  const r = await fetch(`/api/stats/${encodeURIComponent(domain)}?days=${days}`);
  if (!r.ok) throw new Error(`stats request failed: ${r.status}`);
  return r.json();
}

export function getDomainFromPath() {
  const m = location.pathname.match(/^\/([^\/]+)\/?/);
  return m ? decodeURIComponent(m[1]) : null;
}
