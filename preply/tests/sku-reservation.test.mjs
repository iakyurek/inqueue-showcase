// Team-concurrency SKU reservation: outstanding-reservation floors (a second
// batch created before the first exports must start PAST its numbers, not
// collide with them) and the serialization lock around scan->reserve->save.
//
// Run: node preply/tests/sku-reservation.test.mjs

import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-sku-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.PREPLY_BATCHLY_DOWNLOADS_DIR = path.join(SCRATCH, 'batchly-downloads');
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_USERNAME = 'test-user';

const preply = await import('../server.js');
const { outstandingSkuFloors, reserveSkusFromDrive, withSkuReservationLock } = preply;

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

const STORE = {
  id: 'store-a', name: 'StoreA', code: 'CU', skuPrefix: 'CU',
  active: true, skuRootFolderId: 'mock-drive-store-a', store_folder: 'Store_A',
};

await test('outstandingSkuFloors: highest reserved number per store across live batches', () => {
  const batches = [
    { id: 'b1', status: 'Intake Complete', reservedSkus: { D001: { 'store-a': { storeId: 'store-a', sku: 'CU17' } }, D002: { 'store-a': { storeId: 'store-a', sku: 'CU18' } } } },
    { id: 'b2', status: 'Exported', reservedSkus: { D001: { 'store-a': { storeId: 'store-a', sku: 'CU25' } } } },
    { id: 'b3', status: 'Canceled', reservedSkus: { D001: { 'store-a': { storeId: 'store-a', sku: 'CU99' } } } },
  ];
  const floors = outstandingSkuFloors(batches);
  // Exported/canceled batches no longer hold reservations (exported folders
  // are visible to the Drive scan; canceled ones released their numbers).
  assert.equal(floors.get('store-a'), 18);
  assert.equal(outstandingSkuFloors(batches, 'b1').get('store-a'), undefined);
});

await test('reserveSkusFromDrive starts past the outstanding floor', async () => {
  // Mock Drive scan of an empty store yields latestNumber 0; the floor from a
  // live batch must win.
  const floors = new Map([['store-a', 18]]);
  const snapshot = await reserveSkusFromDrive(['D001', 'D002'], [STORE], floors);
  assert.equal(snapshot.reservedSkus.D001['store-a'].sku, 'CU19');
  assert.equal(snapshot.reservedSkus.D002['store-a'].sku, 'CU20');
  assert.equal(snapshot.ranges['store-a'].reservedStart, 'CU19');
  assert.equal(snapshot.ranges['store-a'].reservedEnd, 'CU20');
});

await test('reserveSkusFromDrive without floors keeps legacy numbering', async () => {
  const snapshot = await reserveSkusFromDrive(['D001'], [STORE]);
  assert.equal(snapshot.reservedSkus.D001['store-a'].sku, 'CU1');
});

await test('withSkuReservationLock serializes concurrent sections', async () => {
  const order = [];
  const slow = withSkuReservationLock(async () => {
    order.push('slow-start');
    await new Promise(resolve => setTimeout(resolve, 40));
    order.push('slow-end');
    return 'slow';
  });
  const fast = withSkuReservationLock(async () => {
    order.push('fast');
    return 'fast';
  });
  assert.deepEqual(await Promise.all([slow, fast]), ['slow', 'fast']);
  assert.deepEqual(order, ['slow-start', 'slow-end', 'fast']);
});

await test('lock chain survives a failing section', async () => {
  await assert.rejects(withSkuReservationLock(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await withSkuReservationLock(async () => 'after'), 'after');
});

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1); }
console.log('sku-reservation: all tests passed');
process.exit(0);
