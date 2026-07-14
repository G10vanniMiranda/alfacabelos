import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const returnPath = `${path}${request.nextUrl.search}`;
  if (path.startsWith("/admin/") && !request.cookies.has("barber_admin")) {
    const loginUrl = new URL("/admin", request.url);
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl);
  }
  if (path.startsWith("/barbeiro") && !request.cookies.has("barber_admin")) {
    const loginUrl = new URL("/admin", request.url);
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl);
  }
  if (path === "/cliente" && !request.cookies.has("barber_client")) {
    const loginUrl = new URL("/cliente/login", request.url);
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path+", "/barbeiro/:path*", "/cliente"],
};
