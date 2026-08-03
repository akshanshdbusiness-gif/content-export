import { NextResponse } from "next/server";
import { ConfigError } from "../config";
import { AuthError, verifyOrgAdmin, type VerifiedUser } from "./verify-user";

/**
 * Wraps a route handler behind the Organization Admin/Owner check. AuthErrors
 * (including 400-level validation errors thrown by handlers) become clean JSON
 * responses; configuration errors surface as 400 so the UI can show the actual
 * message instead of an opaque 500.
 */
export async function withOrgAdmin(
  request: Request,
  handler: (user: VerifiedUser) => Promise<Response>,
): Promise<Response> {
  try {
    const user = await verifyOrgAdmin(request);
    return await handler(user);
  } catch (err) {
    if (err instanceof AuthError || err instanceof ConfigError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Misconfiguration and upstream Sitecore failures are actionable by the
    // operator — pass the message through rather than swallowing it.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[content-export] request failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
