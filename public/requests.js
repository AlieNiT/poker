export async function fetchJSON(path, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {...options, signal:controller.signal});
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'Try again.');
      error.status = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The table did not respond. Try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
// The same request ID is retried: a lost response must never charge chips twice.
export async function submitAction(path, payload, headers, timeout) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetchJSON(path, {method:'POST', headers, body:JSON.stringify(payload)}, timeout); }
    catch (error) { if (error.status || attempt === 1) throw error; }
  }
}
