// Server-side timer for standing orders: the agent re-checks them on its own, with no page open.
// It calls the app's own endpoint so it always runs the current code, and it replaces any older timer.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  clearInterval(globalThis.__csTimer);
  const url = `http://localhost:${process.env.PORT || 3311}/api/watch`;
  globalThis.__csTimer = setInterval(() => {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tick: true, min: 60 }), signal: AbortSignal.timeout(170000) }).catch(() => {});
  }, 20000);
}
