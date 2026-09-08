import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'asp-test-'));
process.env['DATABASE_PATH'] = join(dir, 'test.db');
process.env['STORAGE_DIR'] = join(dir, 'storage');

const { migrate } = await import('../src/db/migrate.ts');
const { closeDb } = await import('../src/db/sqlite.ts');
const { enqueue, claim, succeed, fail, jobs } = await import('../src/queue/queue.ts');

describe('ジョブキュー', () => {
  before(() => migrate());
  after(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  test('登録したジョブを取得できる', () => {
    const id = enqueue('test.job', { a: 1 });
    const job = claim('worker-1');
    assert.equal(job?.id, id);
    assert.equal(job?.status, 'running');
    assert.equal(job?.attempts, 1);
    succeed(id, { ok: true });
    assert.equal(jobs.find(id)?.status, 'succeeded');
  });

  test('同じワーカーが二重取得しない（取得済みは残らない）', () => {
    enqueue('test.single', {});
    const first = claim('worker-1');
    const second = claim('worker-2');
    assert.ok(first);
    assert.notEqual(second?.id, first.id);
    if (first) succeed(first.id);
    if (second) succeed(second.id);
  });

  test('dedupeKey により多重起票されない', () => {
    const a = enqueue('test.dedupe', {}, { dedupeKey: 'same' });
    const b = enqueue('test.dedupe', {}, { dedupeKey: 'same' });
    assert.equal(a, b);
  });

  test('失敗すると指数バックオフで再試行が予約される', () => {
    const id = enqueue('test.retry', {}, { maxAttempts: 3, dedupeKey: 'retry' });
    claim('w', ['test.retry']);
    fail(id, 'エラー1');

    const job = jobs.find(id)!;
    assert.equal(job.status, 'queued');
    assert.equal(job.attempts, 1);
    assert.ok(job.last_error?.includes('エラー1'));
    // 即座には拾われないよう、次回実行時刻が未来に押し出される
    assert.ok(new Date(job.run_at).getTime() > Date.now());
  });

  test('試行上限に達したジョブは dead になり自動再試行されない', () => {
    const id = enqueue('test.dead', {}, { maxAttempts: 1, dedupeKey: 'dead' });
    claim('w', ['test.dead']);
    fail(id, '致命的エラー');

    const job = jobs.find(id)!;
    assert.equal(job.status, 'dead');
    assert.equal(claim('w', ['test.dead']), undefined, 'dead は再取得されない');
  });

  test('優先度の高いジョブが先に取得される', () => {
    enqueue('test.low', {}, { priority: 9, dedupeKey: 'low' });
    enqueue('test.high', {}, { priority: 1, dedupeKey: 'high' });
    const job = claim('w', ['test.low', 'test.high']);
    assert.equal(job?.type, 'test.high');
  });
});
