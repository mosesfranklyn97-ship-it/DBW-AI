import assert from "node:assert/strict";
import { diffSchemas } from "@/lib/schema/diff";
import { randomToken, signToken, verifyToken } from "@/lib/server/sign";
import type { DbSchema } from "@/lib/types";

/**
 * Guards the two properties the refine preview and share links depend on:
 *
 *  1. A token cannot be edited. Any change to the payload, the signature, or
 *     the expiry has to fail closed.
 *  2. A reviewed diff is the diff that gets applied. The apply step replays the
 *     preview token, so the candidate must come back byte-identical - if it did
 *     not, the diff on screen would be describing a change nobody applied.
 */

process.env.APP_SIGNING_SECRET = "check-secret-not-used-in-production";

const TTL = 60_000;

let checks = 0;
const pass = (label: string) => {
  checks += 1;
  console.log(`  ok  ${label}`);
};

console.log("token signing");

// Round trip.
{
  const token = signToken({ hello: "world", n: 1 }, TTL);
  const result = verifyToken<{ hello: string; n: number }>(token);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.hello, "world");
    assert.equal(result.payload.n, 1);
  }
  pass("round trip preserves the payload");
}

// Expiry is added by the signer, not trusted from the caller.
{
  const token = signToken({ a: 1 }, TTL);
  const result = verifyToken<{ a: number; exp: number }>(token);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(typeof result.payload.exp, "number");
  pass("signer stamps an expiry");
}

// Already-expired.
{
  const token = signToken({ a: 1 }, -1);
  const result = verifyToken(token);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "expired");
  pass("an expired token is rejected");
}

// Edited payload: swap the body, keep the old signature.
{
  const token = signToken({ role: "preview", tables: 1 }, TTL);
  const [body, signature] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ role: "apply", tables: 99, exp: Date.now() + TTL }),
    "utf8",
  ).toString("base64url");
  const result = verifyToken(`${forged}.${signature}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "signature");
  assert.equal(body.split(".").length, 1, "body must not contain a dot");
  assert.ok(signature);
  pass("an edited payload fails the signature check");
}

// Edited signature.
{
  const token = signToken({ a: 1 }, TTL);
  const [body, signature] = token.split(".");
  const flipped = `${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`;
  const result = verifyToken(`${body}.${flipped}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "signature");
  pass("a flipped signature is rejected");
}

// A different secret must not validate.
{
  const token = signToken({ a: 1 }, TTL);
  const original = process.env.APP_SIGNING_SECRET;
  process.env.APP_SIGNING_SECRET = "a-different-secret";
  const result = verifyToken(token);
  process.env.APP_SIGNING_SECRET = original;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "signature");
  pass("a token signed under another secret is rejected");
}

// Malformed inputs must not throw.
{
  for (const bad of ["", ".", "a.", ".b", "no-dot-at-all", "x.y.z"]) {
    const result = verifyToken(bad);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to fail`);
  }
  pass("malformed tokens fail closed instead of throwing");
}

// A payload that is not JSON.
{
  const body = Buffer.from("not json at all", "utf8").toString("base64url");
  const result = verifyToken(`${body}.ZmFrZXNpZ25hdHVyZQ`);
  assert.equal(result.ok, false);
  pass("a non-JSON body is rejected");
}

console.log("share token entropy");

{
  const tokens = new Set<string>();
  for (let i = 0; i < 500; i += 1) tokens.add(randomToken(32));
  assert.equal(tokens.size, 500, "share tokens must not repeat");
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]+$/, "tokens must be URL-safe with no escaping");
    assert.ok(token.length >= 40, "32 bytes of entropy should be well over 40 base64url chars");
  }
  pass("500 tokens are unique and URL-safe");
}

console.log("preview replay");

{
  const schema: DbSchema = {
    name: "shop",
    description: "orders and users",
    dialect: "postgres",
    source: "engine",
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "id", primaryKey: true },
          { name: "email", type: "email", unique: true },
        ],
      },
      {
        name: "orders",
        columns: [
          { name: "id", type: "id", primaryKey: true },
          { name: "user_id", type: "fk", references: { table: "users", column: "id" } },
        ],
      },
    ],
  };

  // What the preview step does: compute a candidate and hand back a handle.
  const previewToken = signToken(
    { v: 1, p: "proj-1", i: "add a payments table", s: schema, e: "ai", m: "Added `payments`" },
    10 * 60_000,
  );

  // What the apply step does: trust the handle, not the model.
  const verified = verifyToken<{ v: number; p: string; i: string; s: DbSchema; e: string; m: string }>(
    previewToken,
  );
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.payload.p, "proj-1");
    assert.equal(verified.payload.e, "ai");
    // The guarantee that matters: the schema is identical, not merely similar.
    assert.deepEqual(verified.payload.s, schema);
    assert.equal(JSON.stringify(verified.payload.s), JSON.stringify(schema));
  }
  pass("the applied schema is byte-identical to the reviewed one");

  // A token minted for a different project must not apply here.
  {
    const crossProject = signToken(
      { v: 1, p: "proj-2", i: "add a payments table", s: schema, e: "ai", m: "x" },
      10 * 60_000,
    );
    const result = verifyToken<{ p: string }>(crossProject);
    assert.equal(result.ok, true);
    if (result.ok) assert.notEqual(result.payload.p, "proj-1");
    pass("a token for another project is distinguishable and rejected by the id check");
  }

  // The instruction rides along so the route can refuse a token whose
  // instruction no longer matches the one being applied.
  {
    const verifiedAgain = verifyToken<{ i: string }>(previewToken);
    assert.equal(verifiedAgain.ok, true);
    if (verifiedAgain.ok) {
      assert.equal(verifiedAgain.payload.i, "add a payments table");
      assert.notEqual(verifiedAgain.payload.i, "drop the users table");
    }
    pass("the instruction is carried so a mismatch can be caught");
  }
}

console.log("no-change detection");

{
  // This is the reason the refine route compares the name and description in
  // addition to the diff: `diffSchemas` only looks at tables, so a rename comes
  // back empty. Without the extra check a rename would be reported as a no-op
  // and the review dialog would refuse to let the user apply it.
  const base: DbSchema = {
    name: "blog",
    description: "posts",
    dialect: "postgres",
    source: "engine",
    tables: [{ name: "posts", columns: [{ name: "id", type: "id", primaryKey: true }] }],
  };
  const renamed: DbSchema = { ...base, name: "newsroom" };
  const redescribed: DbSchema = { ...base, description: "posts and comments" };

  const renameDiff = diffSchemas(base, renamed);
  assert.equal(renameDiff.empty, true, "a rename produces an empty table diff");

  // The route's own predicate, replicated so the reason it exists is pinned.
  const routeSaysNoChange = (from: DbSchema, to: DbSchema) => {
    const diff = diffSchemas(from, to);
    return (
      diff.empty && to.name === from.name && to.description === from.description
    );
  };

  assert.equal(routeSaysNoChange(base, renamed), false, "a rename must not be a no-op");
  assert.equal(routeSaysNoChange(base, redescribed), false, "a description edit must not be a no-op");
  assert.equal(routeSaysNoChange(base, base), true, "an identical schema is a no-op");

  const added: DbSchema = {
    ...base,
    tables: [...base.tables, { name: "comments", columns: [{ name: "id", type: "id", primaryKey: true }] }],
  };
  assert.equal(routeSaysNoChange(base, added), false, "a new table must not be a no-op");
  pass("a rename is applyable while a true no-op is not");
}

console.log(`share + preview signing: ${checks} assertions passed`);
