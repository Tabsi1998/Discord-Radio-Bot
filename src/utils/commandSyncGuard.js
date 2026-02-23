let queue = Promise.resolve();

export function runExclusive(fn) {
  if (typeof fn !== "function") {
    throw new TypeError("runExclusive erwartet eine Funktion.");
  }

  const run = queue.then(() => fn());
  queue = run
    .then(() => undefined)
    .catch(() => undefined);
  return run;
}

