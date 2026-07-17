import {
  saveSharingSelection,
  sharingOptions,
  sharingStatus,
} from "@/lib/sharing-config";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ...sharingStatus(), options: sharingOptions() });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  }
  let body: { mode?: unknown; documentsPath?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (
    body.mode !== "documents" &&
    body.mode !== "corporate" &&
    body.mode !== "off"
  ) {
    return NextResponse.json(
      { error: "Invalid sharing mode." },
      { status: 400 },
    );
  }
  try {
    saveSharingSelection(
      body.mode,
      typeof body.documentsPath === "string" ? body.documentsPath : undefined,
    );
    return NextResponse.json({ ...sharingStatus(), options: sharingOptions() });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the sharing preference.",
      },
      { status: 400 },
    );
  }
}
