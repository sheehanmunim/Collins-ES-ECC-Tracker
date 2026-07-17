import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashPassword, verifyPassword } from "better-auth/crypto";

const accountVersion = 1 as const;

export type SharedAccount = {
  version: typeof accountVersion;
  accountId: string;
  email: string;
  name: string;
  status: "active";
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
  checksum: string;
};

export type PublicSharedAccount = Pick<
  SharedAccount,
  "accountId" | "email" | "name" | "status" | "createdAt" | "updatedAt"
>;

export function sharedAccountsEnabled() {
  return Boolean(process.env.ECC_SHARED_DATA_DIR?.trim());
}

export async function enrollSharedAccount(input: {
  email: string;
  name: string;
  password: string;
}) {
  const email = normalizeEmail(input.email);
  const existing = readSharedAccount(email);
  if (existing) {
    const valid = await verifyPassword({
      hash: existing.passwordHash,
      password: input.password,
    });
    if (!valid) throw new SharedAccountError("INVALID_CREDENTIALS");
    return { account: toPublicAccount(existing), created: false };
  }

  const now = Date.now();
  const unsigned = {
    version: accountVersion,
    accountId: crypto.randomUUID(),
    email,
    name: normalizeName(input.name, email),
    status: "active" as const,
    passwordHash: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  };
  const account: SharedAccount = {
    ...unsigned,
    checksum: checksumAccount(unsigned),
  };
  const filePath = accountPath(email);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    fs.writeFileSync(filePath, `${JSON.stringify(account)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return { account: toPublicAccount(account), created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = readSharedAccount(email);
    if (
      !winner ||
      !(await verifyPassword({
        hash: winner.passwordHash,
        password: input.password,
      }))
    ) {
      throw new SharedAccountError("INVALID_CREDENTIALS");
    }
    return { account: toPublicAccount(winner), created: false };
  }
}

export async function verifySharedAccount(
  emailInput: string,
  password: string,
) {
  const account = readSharedAccount(normalizeEmail(emailInput));
  if (
    !account ||
    !(await verifyPassword({ hash: account.passwordHash, password }))
  ) {
    throw new SharedAccountError("INVALID_CREDENTIALS");
  }
  return toPublicAccount(account);
}

export class SharedAccountError extends Error {
  constructor(readonly code: "INVALID_CREDENTIALS" | "INVALID_ACCOUNT") {
    super(code);
    this.name = "SharedAccountError";
  }
}

function readSharedAccount(email: string): SharedAccount | null {
  const filePath = accountPath(email);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SharedAccountError("INVALID_ACCOUNT");
  }
  if (!isSharedAccount(parsed)) {
    throw new SharedAccountError("INVALID_ACCOUNT");
  }
  const { checksum, ...unsigned } = parsed;
  if (!safeEqual(checksum, checksumAccount(unsigned))) {
    throw new SharedAccountError("INVALID_ACCOUNT");
  }
  return parsed;
}

function accountPath(email: string) {
  const sharedRoot = process.env.ECC_SHARED_DATA_DIR?.trim();
  if (!sharedRoot) throw new Error("Shared account storage is not configured.");
  const fileName = `${crypto.createHash("sha256").update(email).digest("hex")}.json`;
  return path.join(path.resolve(sharedRoot), ".ecc-sync", "accounts", fileName);
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new SharedAccountError("INVALID_CREDENTIALS");
  }
  return email;
}

function normalizeName(value: string, fallback: string) {
  const name = value.trim().replace(/\s+/g, " ");
  return (name || fallback).slice(0, 200);
}

function checksumAccount(account: Omit<SharedAccount, "checksum">) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(account))
    .digest("hex");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function isSharedAccount(value: unknown): value is SharedAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<SharedAccount>;
  return Boolean(
    account.version === accountVersion &&
      typeof account.accountId === "string" &&
      typeof account.email === "string" &&
      typeof account.name === "string" &&
      account.status === "active" &&
      typeof account.passwordHash === "string" &&
      typeof account.createdAt === "number" &&
      typeof account.updatedAt === "number" &&
      typeof account.checksum === "string",
  );
}

function toPublicAccount(account: SharedAccount): PublicSharedAccount {
  const { accountId, email, name, status, createdAt, updatedAt } = account;
  return { accountId, email, name, status, createdAt, updatedAt };
}
