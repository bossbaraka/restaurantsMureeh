
// ============================================================
// Safe seeding primitives (audit findings C-02 / C-03).
//
// Two invariants are enforced here so no individual seed script can
// re-introduce the demo-credential class of vulnerability:
//
//  1. NO CREDENTIAL LITERALS. Seed accounts are provisioned only from
//     environment variables. A seed that cannot find credentials skips
//     the account entirely instead of falling back to a known password.
//
//  2. NEVER REWRITE AN EXISTING ACCOUNT'S SECURITY FIELDS. `upsert`
//     with an `update` clause touching passwordHash / role / status is
//     how an operator's password rotation or suspension silently got
//     reverted on the next deploy. Existing rows are left alone.
// ============================================================

/** Minimum length demanded of any seed-provided password. */
export const SEED_MIN_PASSWORD_LENGTH = 12;

/**
 * Passwords that must never be accepted from configuration. These are the
 * literals that were previously hard-coded into the tenant seeds, plus the
 * usual suspects — a rotation that lands back on one of these is not a
 * rotation.
 */
const FORBIDDEN_SEED_PASSWORDS = new Set(
  [
    'password123!',
    'password123',
    'password1234',
    'password',
    'admin123',
    'admin1234',
    '123456789',
    '12345678',
    'changeme',
    'letmein',
  ].map((value) => value.toLowerCase())
);

export class SeedCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedCredentialError';
  }
}

/**
 * Validates a seed password. Throws rather than silently downgrading:
 * a misconfigured secret must stop the seed, never mint a weak account.
 */
export function assertStrongSeedPassword(
  password: string | undefined | null,
  label: string
): asserts password is string {
  // An unset variable must surface as a configuration error, not a
  // TypeError from property access on undefined.
  if (typeof password !== 'string' || password.length === 0) {
    throw new SeedCredentialError(
      `${label} is not set. Provide a strong secret (e.g. \`openssl rand -base64 24\`); seeding will not fall back to a default password.`
    );
  }
  if (password.length < SEED_MIN_PASSWORD_LENGTH) {
    throw new SeedCredentialError(
      `${label} must be at least ${SEED_MIN_PASSWORD_LENGTH} characters.`
    );
  }
  if (FORBIDDEN_SEED_PASSWORDS.has(password.toLowerCase())) {
    throw new SeedCredentialError(
      `${label} is a known-weak/previously-leaked password and is rejected. Choose a new secret.`
    );
  }
}

/** Reads an env-configured credential pair. Returns null when unset. */
export function readSeedCredentials(
  emailVar: string,
  passwordVar: string,
  label: string
): { email: string; password: string } | null {
  const email = process.env[emailVar]?.trim().toLowerCase();
  const password = process.env[passwordVar];

  if (!email && !password) return null;

  if (!email || !password) {
    throw new SeedCredentialError(
      `${label}: both ${emailVar} and ${passwordVar} must be set together (found only one).`
    );
  }

  assertStrongSeedPassword(password, passwordVar);
  return { email, password };
}

export interface TenantManagerSeed {
  restaurantId: string;
  name: string;
  /** Env var holding the manager email, e.g. SHOQRAH_MANAGER_EMAIL. */
  emailVar: string;
  /** Env var holding the manager password, e.g. SHOQRAH_MANAGER_PASSWORD. */
  passwordVar: string;
  label: string;
}

export type TenantManagerResult =
  | { status: 'skipped'; reason: string }
  | { status: 'created'; userId: string }
  | { status: 'preserved'; userId: string };
