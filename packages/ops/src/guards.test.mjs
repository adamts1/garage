import { describe, expect, it } from 'vitest';
import { parseCliJson } from './cli.mjs';
import { ENVIRONMENTS, keyProjectRef, looksLikeServiceRole, projectRefOf } from './environments.mjs';

const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

describe('service_role key checks', () => {
  it('accepts a service_role JWT and an opaque secret key', () => {
    expect(looksLikeServiceRole(jwt({ role: 'service_role', ref: 'a' }))).toBe(true);
    expect(looksLikeServiceRole('sb_secret_abc')).toBe(true);
  });

  it('refuses the anon key in either form', () => {
    expect(looksLikeServiceRole(jwt({ role: 'anon', ref: 'a' }))).toBe(false);
    expect(looksLikeServiceRole('sb_publishable_abc')).toBe(false);
    expect(looksLikeServiceRole('garbage')).toBe(false);
  });

  it('reads the project a key belongs to, and none from an opaque key', () => {
    expect(keyProjectRef(jwt({ role: 'service_role', ref: 'farpgkljbmlaeiocrore' }))).toBe('farpgkljbmlaeiocrore');
    expect(keyProjectRef('sb_secret_abc')).toBeNull();
  });

  it('reads the project from a URL', () => {
    expect(projectRefOf('https://poksqsdklnhaumozriqd.supabase.co')).toBe('poksqsdklnhaumozriqd');
  });

  it('keeps staging and production on different projects and files', () => {
    const [prod, staging] = ['production', 'staging'].map((id) => ENVIRONMENTS.find((e) => e.id === id));
    expect(prod.ref).toBe('farpgkljbmlaeiocrore');
    expect(prod.envFile).toBe('.env.production.local');
    expect(staging.ref).not.toBe(prod.ref);
    expect(staging.envFile).toBe('.env.local');
  });
});

describe('parseCliJson', () => {
  it('reads a pretty-printed array', () => {
    expect(parseCliJson({ stdout: '[\n  {"slug": "photo"}\n]\n', stderr: '' })).toEqual([{ slug: 'photo' }]);
  });

  it('reads a one-line object with noise around it', () => {
    const stdout = 'A new version of Supabase CLI is available\n{"functions":[{"slug":"photo"}]}\nbye\n';
    expect(parseCliJson({ stdout, stderr: '' })).toEqual({ functions: [{ slug: 'photo' }] });
  });

  it('throws on an error the CLI reported as JSON, never returns it as data', () => {
    expect(() => parseCliJson({ stdout: '{"_tag":"Error","error":{"message":"Unauthorized"}}', stderr: '' }))
      .toThrow('Unauthorized');
  });

  it('throws on an empty reply rather than reading it as "nothing deployed"', () => {
    expect(() => parseCliJson({ stdout: '', stderr: 'Access token not provided' })).toThrow(/login/);
  });
});
