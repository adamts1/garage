/* Types of what the console's API returns (see admin/server/api.mjs and
   packages/ops), and one fetch helper. */

export type EnvId = 'local' | 'staging' | 'production';

export interface Environment {
  id: EnvId;
  label: string;
  ref: string | null;
  gitRef: string | null;
}

export interface Member {
  email: string;
  role: 'admin' | 'member';
  lastSignIn: string | null;
}

export interface Garage {
  id: string;
  name: string;
  createdAt: string;
  letterhead: Record<string, string | null | undefined>;
  members: Member[];
  invoicing: {
    provider: string;
    active: boolean;
    docType: string;
    vatRate: number;
    credentials: boolean;
    updatedAt: string;
  } | null;
  bookkeeping: {
    software?: string | null;
    accountantEmail?: string | null;
  } | null;
  payments: {
    provider: string;
    active: boolean;
    shopNo: string | null;
    maxInstallments: number;
    installmentsMin: number;
    credentials: boolean;
    authFailedAt?: string | null;
    authError?: string | null;
    updatedAt: string;
  } | null;
}

export interface GaragesReply {
  env: EnvId;
  garages: Garage[];
  missingTables: string[];
}

export interface Migration {
  version: string;
  name: string | null;
}

export interface MigrationsReply {
  env: EnvId;
  gitRef: string | null;
  branchKnown: boolean;
  applied: string[];
  pendingFromBranch: Migration[];
  pendingFromTree: Migration[];
  unknown: Migration[];
}

export interface DeployedFunction {
  version: number;
  updatedAt: number | string;
  hash: string | null;
  status: string | null;
}

export interface FunctionsReply {
  envs: EnvId[];
  rows: {
    name: string;
    inRepo: boolean;
    /** undefined: that environment could not be read. null: not deployed. */
    deployed: Record<string, DeployedFunction | null | undefined>;
    sameEverywhere: boolean | null;
  }[];
  errors: Record<string, string>;
}

export interface DriftReply {
  env: EnvId;
  gitRef: string;
  results: {
    name: string;
    deployed: boolean;
    version?: number;
    updatedAt?: number | string;
    sameAsRef?: boolean;
    offRef?: string[];
    matchesTree?: boolean;
    noSource?: boolean;
    error?: string;
  }[];
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}
