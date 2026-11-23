/* Talking to the console's own server (admin/server/api.ts). */

/** Sent on every write; the server refuses a POST without it. See WRITE_HEADER
 *  in admin/server/api.ts. */
const WRITE_HEADER = { 'X-Garage-Console': '1' } as const;

export class ApiError extends Error {
  readonly status: number;
  /** Field path → error code, when the server rejected the input. */
  readonly fields: Record<string, string> | null;
  constructor(status: number, message: string, fields: Record<string, string> | null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body.fields ?? null);
  return body as T;
}

export async function get<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path));
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  return parse<T>(await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...WRITE_HEADER },
    body: JSON.stringify(body),
  }));
}
