/* Every shape that crosses between packages/ops, the console's server and the
 * console's page. One definition, imported by all three — the page never
 * redeclares what the server sends.
 *
 * No imports and no runtime code: the browser bundle imports this file, and it
 * must not drag anything Node-only in with it.
 */

/* ---------- environments ---------- */

export type EnvId = 'production' | 'staging' | 'local';

export interface EnvironmentInfo {
  id: EnvId;
  /** Display label, in Hebrew. */
  label: string;
  /** Supabase project ref; null for the local stack. */
  ref: string | null;
  /** The branch this environment deploys from; null for local. */
  gitRef: string | null;
}

export interface Environment extends EnvironmentInfo {
  /** The env file holding its URL and service_role key; null for local. */
  envFile: string | null;
}

/* ---------- garages ---------- */

export type MemberRole = 'admin' | 'member';

export interface Letterhead {
  printName: string | null;
  motto: string | null;
  services: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  licenseNo: string | null;
  taxId: string | null;
}

export interface GarageMember {
  email: string;
  role: MemberRole;
  lastSignIn: string | null;
}

export type BillingProvider = 'icount';
export type InvoiceDocType = 'invoice_receipt' | 'tax_invoice';
export type BookkeepingSoftware = 'rivhit' | 'hashavshevet';
export type PaymentProvider = 'pelecard';

export interface InvoicingState {
  provider: string;
  active: boolean;
  docType: InvoiceDocType;
  vatRate: number;
  /** Credentials are stored. The credentials themselves are never read. */
  credentials: boolean;
  updatedAt: string;
}

export interface BookkeepingState {
  /** undefined: the column does not exist in this environment yet. */
  software: BookkeepingSoftware | null | undefined;
  accountantEmail: string | null | undefined;
}

export interface PaymentsState {
  provider: string;
  active: boolean;
  shopNo: string | null;
  maxInstallments: number;
  installmentsMin: number;
  credentials: boolean;
  authFailedAt: string | null | undefined;
  authError: string | null | undefined;
  updatedAt: string;
}

export interface GarageOverview {
  id: string;
  name: string;
  createdAt: string;
  letterhead: Letterhead;
  members: GarageMember[];
  invoicing: InvoicingState | null;
  bookkeeping: BookkeepingState | null;
  payments: PaymentsState | null;
}

export interface GaragesReport {
  env: EnvId;
  garages: GarageOverview[];
  /** Tables whose migration has not reached this environment. */
  missingTables: string[];
}

/* ---------- migrations ---------- */

export interface Migration {
  version: string;
  name: string | null;
}

export interface MigrationStatus {
  env: EnvId;
  gitRef: string | null;
  branchKnown: boolean;
  applied: string[];
  /** On the branch this environment deploys from, and not applied. */
  pendingFromBranch: Migration[];
  /** In the working tree only, not applied. */
  pendingFromTree: Migration[];
  /** Applied, with no file in the working tree. */
  unknown: Migration[];
}

/* ---------- functions ---------- */

export interface DeployedFunction {
  version: number;
  updatedAt: number | string;
  hash: string | null;
  status: string | null;
}

export interface FunctionRow {
  name: string;
  inRepo: boolean;
  /** undefined: that environment could not be read. null: not deployed. */
  deployed: Partial<Record<EnvId, DeployedFunction | null>>;
  /** null when it is not deployed everywhere, so there is nothing to compare. */
  sameEverywhere: boolean | null;
}

export interface FunctionsOverview {
  envs: EnvId[];
  rows: FunctionRow[];
  errors: Partial<Record<EnvId, string>>;
}

export interface FunctionDriftRow {
  name: string;
  deployed: boolean;
  version?: number;
  updatedAt?: number | string;
  sameAsRef?: boolean;
  offRef?: string[];
  matchesTree?: boolean;
  noSource?: boolean;
  error?: string;
}

export interface FunctionDriftReport {
  env: EnvId;
  gitRef: string;
  results: FunctionDriftRow[];
}

/* ---------- mobile ---------- */

export type MobilePlatform = 'IOS' | 'ANDROID';

export type MobileVerdict =
  | 'current'
  | 'behind'
  | 'off-main'
  | 'unknown-commit'
  | 'never-built';

export interface MobileBuildRow {
  platform: MobilePlatform;
  profile: string;
  verdict: MobileVerdict;
  build: {
    id: string;
    appVersion: string | null;
    buildNumber: string | null;
    completedAt: string | null;
    commit: string | null;
    artifactUrl: string | null;
    distribution: string | null;
  } | null;
  /** Commits on the base since the build, and how many of them the app bundles. */
  behind: { total: number; bundled: number; log: string[] } | null;
  /** A later build that did not finish (errored, canceled, in progress). */
  laterAttempt: { status: string; createdAt: string | null } | null;
}

export interface MobileStatus {
  base: string;
  baseCommit: string;
  rows: MobileBuildRow[];
}

/* ---------- onboarding ---------- */

export interface OnboardingInput {
  env: EnvId;
  /** Must equal `env`, typed by hand: the one guard between a staging test and
   *  a real garage in production. */
  confirmEnv: string;

  garage: {
    name: string;
    letterhead: Partial<Letterhead>;
    seedCatalog: boolean;
  };

  admin: {
    email: string;
    /** Empty: one is generated and returned once. */
    password: string;
  };

  invoicing: null | {
    provider: BillingProvider;
    cid: string;
    token: string;
    vatRate: number;
    docType: InvoiceDocType;
    active: boolean;
  };

  bookkeeping: null | {
    software: BookkeepingSoftware | null;
    accountantEmail: string;
  };

  payments: null | {
    /** null: no provider — installments for a card taken on the garage's own
     *  terminal and recorded by hand. */
    credentials: null | { terminal: string; user: string; password: string };
    shopNo: string;
    maxInstallments: number;
    installmentsMin: number;
    active: boolean;
    /** Pelecard's public test terminal on production, for a test garage only. */
    allowTestTerminal: boolean;
    /** A real terminal anywhere but production. */
    realTerminal: boolean;
  };
}

/** Field path → message key, for the form. */
export type ValidationErrors = Partial<Record<string, string>>;

export type OnboardingStepId =
  | 'garage'
  | 'user'
  | 'membership'
  | 'catalog'
  | 'invoicing'
  | 'bookkeeping'
  | 'payments'
  | 'verify';

export interface OnboardingStep {
  id: OnboardingStepId;
  ok: boolean;
  detail?: string;
}

export interface OnboardingResult {
  ok: boolean;
  env: EnvId;
  projectRef: string;
  /** Set as soon as the garage exists, so a run that failed later can be
   *  finished by hand rather than repeated. */
  garageId: string | null;
  steps: OnboardingStep[];
  error?: string;
  login: null | {
    email: string;
    /** Only when this run generated it. Shown once, stored nowhere. */
    password: string | null;
    existingUser: boolean;
  };
}
