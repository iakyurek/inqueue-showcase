import assert from "node:assert/strict";
import test from "node:test";

import { createScheduler, makeSemaphore } from "../lib/designScheduler.js";

// A task that records live concurrency and resolves when told to.
function makeTracker() {
  const state = { inFlight: 0, peak: 0, started: [] };
  const task = (label, work = async () => {}) => async () => {
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    state.started.push(label);
    try {
      return await work();
    } finally {
      state.inFlight -= 1;
    }
  };
  return { state, task };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Deferred promise the test resolves by hand to control task completion order.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("never exceeds maxConcurrent, even with more tasks than slots", async () => {
  const scheduler = createScheduler({ maxConcurrent: 3 });
  const { state, task } = makeTracker();
  const gates = Array.from({ length: 15 }, () => deferred());

  const done = scheduler.submitJob("solo", gates.map((gate, i) => task(i, () => gate.promise)));
  await tick();
  assert.equal(state.inFlight, 3, "exactly 3 designs should be in flight");

  // Release tasks one by one; a freed slot is refilled but never exceeded.
  for (const gate of gates) {
    gate.resolve();
    await tick();
    assert.ok(state.inFlight <= 3);
  }
  await done;
  assert.equal(state.peak, 3);
  assert.equal(state.started.length, 15);
});

test("a single 15-task job fans out across all slots (not one lane)", async () => {
  const scheduler = createScheduler({ maxConcurrent: 4 });
  const { state, task } = makeTracker();
  await scheduler.submitJob("batch", Array.from({ length: 15 }, (_, i) => task(i, tick)));
  assert.equal(state.peak, 4, "solo job should use every slot");
});

test("a second job gets slots while the first is still running (fair sharing)", async () => {
  const scheduler = createScheduler({ maxConcurrent: 2 });
  const startedBy = [];
  const gates = [];
  const job = (id, count) =>
    Array.from({ length: count }, () => () => {
      const gate = deferred();
      gates.push(gate);
      startedBy.push(id);
      return gate.promise;
    });

  const first = scheduler.submitJob("first", job("first", 10));
  await tick();
  assert.deepEqual(startedBy, ["first", "first"], "first job fills both slots while alone");

  const second = scheduler.submitJob("second", job("second", 2));
  await tick();
  gates[0].resolve(); // free one slot; second job has 0 in flight vs first's 1
  await tick();
  assert.equal(startedBy[2], "second", "freed slot must go to the newly queued job");

  // Drain: releasing a task starts the next one (which pushes a new gate),
  // so keep resolving until both jobs have fully settled.
  let settled = false;
  const all = Promise.all([first, second]).then(() => { settled = true; });
  while (!settled) {
    for (const gate of gates.splice(0)) gate.resolve();
    await tick();
  }
  await all;
});

test("results settle in task order with rejections kept in place", async () => {
  const scheduler = createScheduler({ maxConcurrent: 2 });
  const results = await scheduler.submitJob("mixed", [
    async () => "a",
    async () => { throw new Error("boom"); },
    async () => "c",
  ]);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], { status: "fulfilled", value: "a" });
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /boom/);
  assert.deepEqual(results[2], { status: "fulfilled", value: "c" });
});

test("makeSemaphore serializes work beyond its limit", async () => {
  const run = makeSemaphore(1);
  const { state, task } = makeTracker();
  await Promise.all([run(task(0, tick)), run(task(1, tick)), run(task(2, tick))]);
  assert.equal(state.peak, 1, "limit 1 must fully serialize");
  assert.equal(state.started.length, 3);
});

test("makeSemaphore releases its slot when the task throws", async () => {
  const run = makeSemaphore(1);
  await assert.rejects(run(async () => { throw new Error("fail"); }));
  // If the slot leaked, this second run would hang forever.
  assert.equal(await run(async () => "recovered"), "recovered");
});
