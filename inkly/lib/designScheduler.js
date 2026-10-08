// Design-level fair scheduler. Every submitted job contributes individual
// design tasks to one global pool with a hard concurrency cap. Each freed
// slot goes to the job with the fewest designs in flight (ties -> the job
// submitted first), so a solo 15-design job fans out across every slot while
// a teammate's new job starts getting slots as soon as any design finishes.

export function createScheduler({ maxConcurrent = 3 } = {}) {
  const jobs = [];
  let inFlight = 0;

  function pump() {
    while (inFlight < maxConcurrent) {
      let pick = null;
      for (const job of jobs) {
        if (!job.queue.length) continue;
        if (!pick || job.inFlight < pick.inFlight) pick = job;
      }
      if (!pick) return;
      const entry = pick.queue.shift();
      pick.inFlight += 1;
      inFlight += 1;
      Promise.resolve()
        .then(entry.task)
        .then(
          (value) => entry.resolve({ status: "fulfilled", value }),
          (reason) => entry.resolve({ status: "rejected", reason }),
        )
        .finally(() => {
          pick.inFlight -= 1;
          inFlight -= 1;
          if (!pick.queue.length && pick.inFlight === 0) {
            const at = jobs.indexOf(pick);
            if (at !== -1) jobs.splice(at, 1);
          }
          pump();
        });
    }
  }

  // Resolves when every task has settled, with results in task order
  // (same shape as Promise.allSettled). Tasks are () => Promise functions.
  function submitJob(jobId, tasks) {
    const job = { jobId, queue: [], inFlight: 0 };
    jobs.push(job);
    const settlements = tasks.map(
      (task) => new Promise((resolve) => { job.queue.push({ task, resolve }); }),
    );
    pump();
    return Promise.all(settlements);
  }

  return { submitJob };
}

// Minimal counting semaphore: `run(fn)` waits for a slot, runs fn, releases.
export function makeSemaphore(limit) {
  let active = 0;
  const waiters = [];
  const admit = () => {
    if (active >= limit || !waiters.length) return;
    active += 1;
    waiters.shift()();
  };
  return async function run(fn) {
    await new Promise((resolve) => { waiters.push(resolve); admit(); });
    try {
      return await fn();
    } finally {
      active -= 1;
      admit();
    }
  };
}
