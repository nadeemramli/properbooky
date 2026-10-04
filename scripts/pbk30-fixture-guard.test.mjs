// Deterministic checks for scripts/pbk30-fixture-guard.mjs (no Docker needed):
// every wrong target must be refused before any destructive call.
// Run: node --test scripts/pbk30-fixture-guard.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureProblems, FIXTURE_PROJECT_ID } from "./pbk30-fixture-guard.mjs";

const NONCE = "a".repeat(48);
const API = "http://127.0.0.1:55421";

// A healthy fixture: every probe agrees. Each test breaks one thing.
function probes(overrides = {}) {
  const state = {
    marker: { project_id: FIXTURE_PROJECT_ID, nonce: NONCE, api_url: API },
    configId: FIXTURE_PROJECT_ID,
    labels: { [`supabase_db_${FIXTURE_PROJECT_ID}`]: FIXTURE_PROJECT_ID },
    nonces: { [FIXTURE_PROJECT_ID]: [NONCE] },
    ports: { [`supabase_kong_${FIXTURE_PROJECT_ID}`]: ["55421"] },
    ...overrides,
  };
  return {
    readMarker: () => state.marker,
    configProjectId: () => state.configId,
    containerLabel: (name) => state.labels[name] ?? null,
    dbNonces: (id) => state.nonces[id] ?? null,
    publishedPorts: (name) => state.ports[name] ?? null,
  };
}

const run = (p, opts = {}) =>
  fixtureProblems({ dir: "/fixture", env: { PBK30_DISPOSABLE: "1" }, target: API, probes: p, ...opts });

test("the marked fixture stack passes, including destructive steps", () => {
  assert.deepEqual(run(probes(), { destructive: true }), []);
});

test("no marker (ordinary or unmarked stack) is refused", () => {
  const problems = run(probes({ marker: null }), { destructive: true });
  assert.match(problems.join(), /no fixture marker/);
});

test("a marker naming the ordinary properbooky project is refused", () => {
  const ordinary = probes({
    marker: { project_id: "properbooky", nonce: NONCE, api_url: "http://127.0.0.1:54321" },
    configId: "properbooky",
    labels: { supabase_db_properbooky: "properbooky" },
    nonces: { properbooky: [NONCE] },
    ports: { supabase_kong_properbooky: ["54321"] },
  });
  const problems = run(ordinary, { target: "http://127.0.0.1:54321", destructive: true });
  assert.ok(problems.some((p) => /ordinary development project/.test(p)));
  assert.ok(problems.some((p) => /not the fixture project/.test(p)));
});

test("a wrong project in the fixture workdir config is refused", () => {
  assert.match(run(probes({ configId: "properbooky" })).join(), /config\.toml project_id is "properbooky"/);
});

test("a fixture database that is not running is refused", () => {
  assert.match(run(probes({ labels: {} })).join(), /is not running/);
});

test("a container labelled for another project is refused", () => {
  const p = probes({ labels: { [`supabase_db_${FIXTURE_PROJECT_ID}`]: "properbooky" } });
  assert.match(run(p).join(), /belongs to project "properbooky"/);
});

test("a database without this marker's nonce is refused", () => {
  assert.match(run(probes({ nonces: { [FIXTURE_PROJECT_ID]: ["b".repeat(48)] } })).join(), /does not hold this marker's nonce/);
  assert.match(run(probes({ nonces: {} })).join(), /cannot read pbk30_fixture\.marker/);
});

test("a target URL other than the fixture API (e.g. the ordinary stack) is refused", () => {
  const problems = run(probes(), { target: "http://127.0.0.1:54321" });
  assert.match(problems.join(), /is not the fixture API/);
});

test("a fixture API port not published by the fixture gateway is refused", () => {
  assert.match(run(probes({ ports: { [`supabase_kong_${FIXTURE_PROJECT_ID}`]: ["54321"] } })).join(), /not published/);
});

test("destructive steps without PBK30_DISPOSABLE=1 are refused", () => {
  const problems = run(probes(), { destructive: true, env: {} });
  assert.deepEqual(problems, ["destructive step needs PBK30_DISPOSABLE=1"]);
});

test("non-destructive checks do not need PBK30_DISPOSABLE", () => {
  assert.deepEqual(run(probes(), { env: {} }), []);
});

test("a marker without a usable nonce is refused", () => {
  const p = probes({ marker: { project_id: FIXTURE_PROJECT_ID, nonce: "short", api_url: API } });
  assert.match(run(p).join(), /no usable nonce/);
});
