import { describe, expect, it } from 'vitest';
import { scrubUrl } from './scrub';

/* These URLs are the real shapes our own db.ts produces. If one of these ever
   leaks a value, a customer's name or phone number leaves the browser. */

const SUPA = 'https://abcdefgh.supabase.co/rest/v1';

describe('scrubUrl — PostgREST filters carrying PII', () => {
  it('redacts a customer name lookup (findOrCreateCustomer)', () => {
    const url = `${SUPA}/customers?select=id&name=eq.${encodeURIComponent('יוסי לוי')}`;
    const out = scrubUrl(url);
    expect(out).not.toContain('יוסי');
    expect(out).not.toContain(encodeURIComponent('יוסי לוי'));
    expect(out).toContain('name=<redacted>');
  });

  it('redacts a plate lookup', () => {
    const out = scrubUrl(`${SUPA}/vehicles?plate=eq.12-345-67`);
    expect(out).not.toContain('12-345-67');
    expect(out).toContain('plate=<redacted>');
  });

  it('redacts phone and email filters', () => {
    const out = scrubUrl(`${SUPA}/customers?phone=eq.050-1234567&email=eq.a%40b.com`);
    expect(out).not.toContain('050-1234567');
    expect(out).not.toContain('a%40b.com');
  });

  it('redacts a ticket key filter', () => {
    const out = scrubUrl(`${SUPA}/tickets?select=id&key=eq.GAR-142`);
    expect(out).not.toContain('GAR-142');
  });

  it('redacts an embedded-resource filter (listTicketPhotos)', () => {
    const out = scrubUrl(`${SUPA}/ticket_photos?select=id,path&tickets.key=eq.GAR-142`);
    expect(out).not.toContain('GAR-142');
  });
});

describe('scrubUrl — keeps what is safe', () => {
  it('preserves the origin and path', () => {
    const out = scrubUrl(`${SUPA}/customers?name=eq.x`);
    expect(out).toContain('https://abcdefgh.supabase.co/rest/v1/customers');
  });

  it('keeps query shape: param names survive', () => {
    const out = scrubUrl(`${SUPA}/customers?name=eq.x&city=eq.y`);
    expect(out).toContain('name=');
    expect(out).toContain('city=');
  });

  it('returns an all-safe URL untouched, without re-encoding it (listTickets)', () => {
    const url = `${SUPA}/tickets?select=*,works(*)&order=created_at.desc&limit=50`;
    expect(scrubUrl(url)).toBe(url);
  });

  it('keeps safe params intact while redacting an unsafe one alongside them', () => {
    const out = scrubUrl(`${SUPA}/tickets?select=*,works(*)&key=eq.GAR-142&order=created_at.desc`);
    expect(out).not.toContain('GAR-142');
    expect(out).toContain('key=<redacted>');
    // Mixed queries get re-encoded by URLSearchParams — encoding only, no loss.
    expect(decodeURIComponent(out)).toContain('select=*,works(*)');
    expect(decodeURIComponent(out)).toContain('order=created_at.desc');
  });

  it('leaves a URL with no query string untouched', () => {
    const url = 'https://abcdefgh.supabase.co/storage/v1/object/public/ticket-photos/GAR-142/1.jpg';
    expect(scrubUrl(url)).toBe(url);
  });
});

describe('scrubUrl — fails closed', () => {
  it('redacts unknown params by default (allowlist, not blocklist)', () => {
    const out = scrubUrl(`${SUPA}/tickets?some_future_filter=eq.${encodeURIComponent('סוד')}`);
    expect(out).not.toContain(encodeURIComponent('סוד'));
    expect(out).toContain('some_future_filter=<redacted>');
  });

  it('drops the query entirely when the URL cannot be parsed', () => {
    const out = scrubUrl('::: not a url :::?name=eq.secret');
    expect(out).not.toContain('secret');
  });

  it('handles relative URLs', () => {
    const out = scrubUrl('/rest/v1/customers?name=eq.secret');
    expect(out).not.toContain('secret');
    expect(out).toContain('/rest/v1/customers');
  });

  it('handles empty input', () => {
    expect(scrubUrl('')).toBe('');
  });
});
