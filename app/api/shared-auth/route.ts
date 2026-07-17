import {
  enrollSharedAccount,
  SharedAccountError,
  sharedAccountsEnabled,
  verifySharedAccount,
} from "@/lib/shared-accounts";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attempts = new Map<string, { failures: number; blockedUntil: number }>();
const failureWindowMs = 15 * 60 * 1000;
const maximumFailures = 8;

export async function POST(request: NextRequest) {
  if (!sharedAccountsEnabled()) {
    return NextResponse.json({ shared: false });
  }

  let body: {
    action?: unknown;
    email?: unknown;
    password?: unknown;
    name?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid request.", 400);
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name : email;
  const key = `${request.headers.get("x-forwarded-for") ?? "local"}:${email.trim().toLowerCase()}`;
  const currentAttempt = attempts.get(key);
  if (currentAttempt && currentAttempt.blockedUntil > Date.now()) {
    return errorResponse("Too many attempts. Try again in 15 minutes.", 429);
  }
  if (password.length < 8 || password.length > 128) {
    recordFailure(key);
    return errorResponse("Invalid email or password.", 401);
  }

  try {
    if (body.action === "enroll") {
      const result = await enrollSharedAccount({ email, name, password });
      attempts.delete(key);
      return NextResponse.json({ shared: true, ...result });
    }
    if (body.action === "verify") {
      const account = await verifySharedAccount(email, password);
      attempts.delete(key);
      return NextResponse.json({ shared: true, account });
    }
    return errorResponse("Invalid request.", 400);
  } catch (error) {
    if (error instanceof SharedAccountError) {
      recordFailure(key);
      const message =
        error.code === "INVALID_ACCOUNT"
          ? "The shared account record is damaged. Contact the tracker administrator."
          : "Invalid email or password.";
      return errorResponse(
        message,
        error.code === "INVALID_ACCOUNT" ? 503 : 401,
      );
    }
    console.error("Shared account operation failed", error);
    return errorResponse(
      "Shared account storage is temporarily unavailable.",
      503,
    );
  }
}

function recordFailure(key: string) {
  const now = Date.now();
  const previous = attempts.get(key);
  const failures =
    previous && previous.blockedUntil > now - failureWindowMs
      ? previous.failures + 1
      : 1;
  attempts.set(key, {
    failures,
    blockedUntil: failures >= maximumFailures ? now + failureWindowMs : now,
  });
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ shared: true, error: message }, { status });
}
