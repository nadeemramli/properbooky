#!/usr/bin/env node
// Guard for the PBK-30 disposable fixture stack.
//
// Every PBK-30 check that writes to Supabase (synthetic users, books, uploads)
// or destroys anything (dropping the stack's volumes, deleting the fixture's
// dev account) must first prove its target is the fixture stack created by
// scripts/pbk30-stack.sh, never an ordinary developer stack:
//
//   1. the marker file written at creation exists and names the fixture
//      project id (never the ordinary "properbooky" id);
//   2. the fixture workdir's config.toml carries that same project id;
//   3. the database container for that project exists and carries the CLI's
//      project label for it;
//   4. that database holds the marker's random nonce (pbk30_fixture.marker),
//      so the marker cannot be pointed at another stack;
//   5. the Supabase URL in use is the fixture's API URL, published by the
//      fixture's own API gateway container;
//   6. destructive steps additionally need PBK30_DISPOSABLE=1.
//
// Usage: node scripts/pbk30-fixture-guard.mjs [--destructive] [--target <url>]
// Exit 0 when every check passes; exit 3 (and print every reason) otherwise.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_PROJECT_ID = "pbk30-fixture";
export const ORDINARY_PROJECT_ID = "properbooky";
const LABEL = "com.supabase.cli.project";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STACK_DIR = path.resolve(process.env.PBK30_STACK_DIR ?? path.join(repoRoot, ".pbk30-stack"));

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Real probes; tests substitute fakes. Each returns null when absent. */
export const liveProbes = {
  readMarker(dir) {
    try {
      return JSON.parse(readFileSync(path.join(dir, "marker.json"), "utf8"));
    } catch {
      return null;
    }
  },
  configProjectId(dir) {
    try {
      const toml = readFileSync(path.join(dir, "supabase", "config.toml"), "utf8");
      return /^project_id\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? null;
    } catch {
      return null;
    }
  },
  containerLabel(name) {
    try {
      return docker(["inspect", "-f", `{{index .Config.Labels "${LABEL}"}}`, name]) || null;
    } catch {
      return null;
    }
  },
  dbNonces(projectId) {
    try {
      const out = docker([
        "exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-Atc",
        "select nonce from pbk30_fixture.marker",
      ]);
      return out ? out.split("\n") : [];
    } catch {
      return null;
    }
  },
  publishedPorts(name) {
    try {
      return Object.values(JSON.parse(docker(["inspect", "-f", "{{json .NetworkSettings.Ports}}", name])) ?? {})
        .flat()
        .filter(Boolean)
        .map((b) => String(b.HostPort));
    } catch {
      return null;
    }
  },
};

/**
 * Returns the list of reasons the target is NOT the marked fixture stack
 * (empty list = safe). Pure apart from the injected probes.
 */
export function fixtureProblems({ destructive = false, target, env = process.env, dir = STACK_DIR, probes = liveProbes } = {}) {
  const problems = [];
  const marker = probes.readMarker(dir);
  if (!marker) return [`no fixture marker at ${path.join(dir, "marker.json")} (create the stack with scripts/pbk30-stack.sh create)`];

  const id = marker.project_id;
  if (id !== FIXTURE_PROJECT_ID) problems.push(`marker names project "${id}", not the fixture project "${FIXTURE_PROJECT_ID}"`);
  if (id === ORDINARY_PROJECT_ID) problems.push(`refusing the ordinary development project "${ORDINARY_PROJECT_ID}"`);
  if (typeof marker.nonce !== "string" || marker.nonce.length < 32) problems.push("marker has no usable nonce");

  const configId = probes.configProjectId(dir);
  if (configId !== id) problems.push(`fixture workdir config.toml project_id is "${configId}", marker says "${id}"`);

  const db = `supabase_db_${id}`;
  const label = probes.containerLabel(db);
  if (label !== id) problems.push(`database container ${db} ${label === null ? "is not running" : `belongs to project "${label}"`}`);

  const nonces = probes.dbNonces(id);
  if (nonces === null) problems.push(`cannot read pbk30_fixture.marker from ${db}`);
  else if (!nonces.includes(marker.nonce)) problems.push(`${db} does not hold this marker's nonce (stack was not created by this marker)`);

  const url = target ?? env.NEXT_PUBLIC_SUPABASE_URL;
  if (url !== undefined) {
    if (url !== marker.api_url) problems.push(`target Supabase URL ${url} is not the fixture API ${marker.api_url}`);
    const port = (() => {
      try {
        return new URL(marker.api_url).port;
      } catch {
        return "";
      }
    })();
    const ports = probes.publishedPorts(`supabase_kong_${id}`);
    if (!ports?.includes(port)) problems.push(`fixture API port ${port} is not published by supabase_kong_${id}`);
  }

  if (destructive && env.PBK30_DISPOSABLE !== "1") problems.push("destructive step needs PBK30_DISPOSABLE=1");
  return problems;
}

export function assertFixture(options) {
  const problems = fixtureProblems(options);
  if (problems.length) {
    throw new Error(`PBK-30 fixture guard refused:\n  - ${problems.join("\n  - ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const destructive = args.includes("--destructive");
  const t = args.indexOf("--target");
  const target = t >= 0 ? args[t + 1] : undefined;
  const problems = fixtureProblems({ destructive, target });
  if (problems.length) {
    console.error(`PBK-30 fixture guard refused${destructive ? " (destructive)" : ""}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(3);
  }
  console.log(`PBK-30 fixture guard: ok (${FIXTURE_PROJECT_ID}${destructive ? ", destructive allowed" : ""})`);
}
