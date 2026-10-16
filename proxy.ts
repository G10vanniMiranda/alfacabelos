import { NextRequest, NextResponse } from "next/server";
import { platformRequestId } from "@/lib/observability/context";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const returnPath = `${path}${request.nextUrl.search}`;
  const requestId = platformRequestId(request.headers);
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-request-id", requestId);
  const redirect = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.headers.set("x-request-id", requestId);
    return response;
  };
  if (path.startsWith("/admin/") && !request.cookies.has("barber_admin")) {
    const loginUrl = new URL("/admin", request.url);
    loginUrl.searchParams.set("next", returnPath);
    return redirect(loginUrl);
  }
  if (path.startsWith("/barbeiro") && !request.cookies.has("barber_admin")) {
    const loginUrl = new URL("/admin", request.url);
    loginUrl.searchParams.set("next", returnPath);
    return redirect(loginUrl);
  }
  if (path === "/cliente" && !request.cookies.has("barber_client")) {
    const loginUrl = new URL("/cliente/login", request.url);
    loginUrl.searchParams.set("next", returnPath);
    return redirect(loginUrl);
  }
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
};
