import { applyAppUpdate, getAppUpdateStatus } from "@/lib/app-update";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  return NextResponse.json(await getAppUpdateStatus(force));
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  }
  const result = await applyAppUpdate();
  return NextResponse.json(result, {
    status: result.state === "error" ? 500 : 200,
  });
}
