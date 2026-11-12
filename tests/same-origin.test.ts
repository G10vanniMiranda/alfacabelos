import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/security";

function requestTo(listener: string, headers: Record<string, string>) {
  return new NextRequest(`${listener}/api/booking`, { method: "POST", headers });
}

test("same-origin check accepts the public origin behind a reverse proxy and rejects others", () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://alfa.example.test";
  try {
    // Standalone server behind Traefik: nextUrl is the internal listener, Origin is the public host.
    assert.equal(isSameOriginRequest(requestTo("http://0.0.0.0:3000", { origin: "https://alfa.example.test" })), true);
    assert.equal(isSameOriginRequest(requestTo("http://0.0.0.0:3000", { origin: "https://evil.example.test" })), false);
    assert.equal(isSameOriginRequest(requestTo("http://0.0.0.0:3000", { origin: "http://alfa.example.test" })), false);
    assert.equal(isSameOriginRequest(requestTo("http://0.0.0.0:3000", { origin: "https://alfa.example.test", "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOriginRequest(requestTo("http://0.0.0.0:3000", { origin: "null" })), false);
    // Direct (Vercel-style) requests keep working.
    assert.equal(isSameOriginRequest(requestTo("https://alfa.example.test", { origin: "https://alfa.example.test" })), true);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
