import { describe, expect, it } from 'vitest';
import { pushSources, readPushReply } from './migrations.ts';

describe('readPushReply', () => {
  it('reads the list a dry run would push', () => {
    const text = 'DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n • 20261125090000_a.sql\n • 20261125100000_b_c.sql\nFinished supabase db push.';
    expect(readPushReply(text)).toEqual({ files: ['20261125090000_a.sql', '20261125100000_b_c.sql'], needsIncludeAll: false });
  });
  it('is empty when up to date', () => {
    expect(readPushReply('Remote database is up to date.')).toEqual({ files: [], needsIncludeAll: false });
  });
  it('recognises the out-of-order refusal', () => {
    const text = 'Found local migration files to be inserted before the last migration on remote database.\n\nRerun the command with --include-all flag to apply these migrations:\nsupabase/migrations/20200101000000_old.sql';
    expect(readPushReply(text)).toEqual({ files: ['20200101000000_old.sql'], needsIncludeAll: true });
  });
});

describe('pushSources', () => {
  it('gives production its branch only, local its tree only', () => {
    expect(pushSources({ id: 'production', gitRef: 'origin/main' })).toEqual(['branch']);
    expect(pushSources({ id: 'staging', gitRef: 'origin/staging' })).toEqual(['branch', 'tree']);
    expect(pushSources({ id: 'local', gitRef: null })).toEqual(['tree']);
  });
});
