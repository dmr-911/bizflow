import { NextResponse, type NextRequest } from "next/server";

// Cheap first gate for the app: no session cookie means sign in first. Real
// validation (session, subscription) happens server-side in every page, action and route.
// Everything else (landing page, legal pages, signup, payment callbacks) is public.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!req.cookies.has("bf_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Must be a static literal for Next.js. Keep in sync with the routes under src/app/(app) and /print.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/customers/:path*",
    "/quotations/:path*",
    "/invoices/:path*",
    "/follow-ups/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/billing/:path*",
    "/print/:path*",
  ],
};
