import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramClient, resolveAgentPermissions } from "./client.js";

test("tool client invokes only the named local bridge path", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:4840/tools/instagram_get_account");
    assert.equal(options.headers.Authorization, `Bearer ${"a".repeat(64)}`);
    assert.equal(options.body, "{}");
    return new Response(JSON.stringify({ id: "777" }), { status: 200 });
  };
  const client = createInstagramClient({
    serviceUrl: "http://127.0.0.1:4840",
    token: "a".repeat(64),
  });

  assert.deepEqual(await client.invoke("instagram_get_account", {}), {
    id: "777",
  });
});

test("tool client rejects control characters without echoing the credential", () => {
  const token = `${"a".repeat(64)}\nsecret`;
  assert.throws(
    () =>
      createInstagramClient({
        serviceUrl: "http://127.0.0.1:4840",
        token,
      }),
    (error) => !error.message.includes(token),
  );
});

test("agent permission resolution drops unknown permissions", () => {
  const known = new Set(["account.read", "comments.write"]);
  const result = resolveAgentPermissions(
    {
      defaultPermissions: ["account.read", "unknown"],
      agentPermissions: { marketing: ["comments.write", "unknown"] },
    },
    "marketing",
    known,
  );
  assert.deepEqual(result, ["comments.write"]);
});
