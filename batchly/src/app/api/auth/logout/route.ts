// Local logout — clears the inQueue session cookie on this origin. The hub
// also has its own /api/logout; each app clears the cookie so a user in
// Batchly can log out without a hub round-trip.
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("inqueue_session", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
