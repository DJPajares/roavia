import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      data: {
        service: "web",
        status: "ok",
        version: "v1",
      },
    },
    {
      headers: { "cache-control": "no-store" },
    },
  );
}
