import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramClient } from "../src/client.js";

test("client rejects a remote service origin", () => {
  assert.throws(
    () =>
      createInstagramClient({
        serviceUrl: "https://remote.example",
        token: "t".repeat(64),
      }),
    /approved local host/,
  );
});

test("client rejects control characters without echoing the credential", () => {
  const token = `${"t".repeat(64)}\nsecret`;
  assert.throws(
    () =>
      createInstagramClient({
        serviceUrl: "http://127.0.0.1:4840",
        token,
      }),
    (error) => !error.message.includes(token),
  );
});

test("operator client sends its bearer token and bounded JSON", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:4840/operator/pending");
    assert.equal(options.headers.Authorization, `Bearer ${"t".repeat(64)}`);
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const client = createInstagramClient({
    serviceUrl: "http://127.0.0.1:4840",
    token: "t".repeat(64),
  });

  assert.deepEqual(await client.request("/operator/pending"), { data: [] });
});

test("operator client returns normalized service failures", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: false,
        error: { code: "POLICY_BLOCKED", message: "Writes are disabled" },
      }),
      { status: 400 },
    );
  const client = createInstagramClient({
    serviceUrl: "http://127.0.0.1:4840",
    token: "t".repeat(64),
  });

  await assert.rejects(client.request("/operator/pending"), {
    code: "POLICY_BLOCKED",
    message: "Writes are disabled",
  });
});
