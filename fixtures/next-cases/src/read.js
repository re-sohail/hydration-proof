// Suspense-compatible data reading that works in React 18 and 19 (throws the
// pending promise). The cache lives per JavaScript realm, so the server and
// the browser each fetch once.
const cache = new Map();

export function read(key, load) {
  let entry = cache.get(key);
  if (!entry) {
    entry = { status: 'pending' };
    entry.promise = load().then(
      (value) => {
        entry.status = 'done';
        entry.value = value;
      },
      (error) => {
        entry.status = 'error';
        entry.value = error;
      },
    );
    cache.set(key, entry);
  }
  if (entry.status === 'pending') throw entry.promise;
  if (entry.status === 'error') throw entry.value;
  return entry.value;
}
