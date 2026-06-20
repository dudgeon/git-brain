#!/usr/bin/env node
/**
 * Backfill brains for previously-ignored repos (ADR-011, Q7).
 *
 * Before multi-repo support, setup only synced the FIRST repo of each GitHub
 * App installation (`repos[0]`). Any other repos the install could access were
 * silently never synced. This script materializes a brain (installations row +
 * initial sync) for every repo on every installation by replaying the now
 * idempotent setup callback, which creates one brain per accessible repo.
 *
 * It is non-destructive: the setup callback dedupes on
 * (github_installation_id, repo_full_name), so re-running is safe and existing
 * brains are left untouched.
 *
 * Prerequisites:
 *   - `wrangler` authenticated to the Cloudflare account (reads D1)
 *   - The Worker deployed with multi-repo support
 *
 * Usage:
 *   node scripts/backfill-brains.mjs                  # dry run (lists installs)
 *   node scripts/backfill-brains.mjs --apply          # replay setup for each install
 *   WORKER_URL=https://brainstem.cc node scripts/backfill-brains.mjs --apply
 */

import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const WORKER_URL = process.env.WORKER_URL || "https://brainstem.cc";
const DB_NAME = "brain-stem-db";

function queryDistinctInstallations() {
  const sql =
    "SELECT DISTINCT github_installation_id, account_login, COUNT(*) AS brain_count " +
    "FROM installations GROUP BY github_installation_id";
  const raw = execSync(
    `wrangler d1 execute ${DB_NAME} --remote --json --command ${JSON.stringify(sql)}`,
    { encoding: "utf8" }
  );
  // wrangler emits an array of result sets: [{ results: [...] }]
  const parsed = JSON.parse(raw);
  const results = Array.isArray(parsed) ? parsed[0]?.results : parsed.results;
  return results || [];
}

async function replaySetup(githubInstallationId) {
  const url = `${WORKER_URL}/setup/callback?installation_id=${githubInstallationId}`;
  const res = await fetch(url, { redirect: "manual" });
  return res.status;
}

async function main() {
  console.log(`Backfill brains — ${APPLY ? "APPLY" : "DRY RUN"} (worker: ${WORKER_URL})\n`);

  let installs;
  try {
    installs = queryDistinctInstallations();
  } catch (e) {
    console.error("Failed to query D1. Is wrangler authenticated?\n", e.message);
    process.exit(1);
  }

  if (installs.length === 0) {
    console.log("No installations found.");
    return;
  }

  console.log(`Found ${installs.length} GitHub installation(s):`);
  for (const row of installs) {
    console.log(`  • install ${row.github_installation_id} (${row.account_login}) — ${row.brain_count} existing brain(s)`);
  }
  console.log("");

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to create brains for any unsynced repos.");
    return;
  }

  for (const row of installs) {
    process.stdout.write(`Replaying setup for install ${row.github_installation_id}… `);
    try {
      const status = await replaySetup(row.github_installation_id);
      console.log(`HTTP ${status}`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }

  console.log("\nDone. New brains sync in the background; verify with /debug/status/{uuid}.");
}

main();
