#!/usr/bin/env node
/**
 * Setup Cloudflare Email Routing for brainstem.cc
 *
 * Prerequisites:
 *   - CLOUDFLARE_API_TOKEN env var (needs Zone:Edit, Email Routing:Edit, DNS:Edit permissions)
 *   - brainstem.cc domain on Cloudflare
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=xxx node scripts/setup-email-routing.mjs
 *
 * What this script does:
 *   1. Finds the zone ID for brainstem.cc
 *   2. Checks if Email Routing is enabled
 *   3. Enables Email Routing if needed
 *   4. Sets the catch-all rule to route to the home-brain-mcp Worker
 */

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DOMAIN = "brainstem.cc";
const WORKER_NAME = "home-brain-mcp";
const CF_API = "https://api.cloudflare.com/client/v4";

if (!API_TOKEN) {
  console.error("Error: CLOUDFLARE_API_TOKEN environment variable is required.");
  console.error("Create a token at https://dash.cloudflare.com/profile/api-tokens with:");
  console.error("  - Zone: Edit");
  console.error("  - Email Routing Rules: Edit");
  console.error("  - DNS: Edit");
  process.exit(1);
}

const headers = {
  "Authorization": `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${CF_API}${path}`, opts);
  const data = await res.json();
  if (!data.success) {
    console.error(`API error at ${method} ${path}:`, JSON.stringify(data.errors, null, 2));
  }
  return data;
}

async function main() {
  // 1. Get zone ID
  console.log(`\n1. Finding zone for ${DOMAIN}...`);
  const zones = await api("GET", `/zones?name=${DOMAIN}`);
  if (!zones.success || !zones.result?.length) {
    console.error(`Zone not found for ${DOMAIN}. Is it on this Cloudflare account?`);
    process.exit(1);
  }
  const zoneId = zones.result[0].id;
  console.log(`   Zone ID: ${zoneId}`);

  // 2. Check Email Routing status
  console.log("\n2. Checking Email Routing status...");
  const routing = await api("GET", `/zones/${zoneId}/email/routing`);
  if (routing.success) {
    const enabled = routing.result?.enabled;
    console.log(`   Email Routing enabled: ${enabled}`);

    if (!enabled) {
      console.log("\n3. Enabling Email Routing...");
      const enable = await api("POST", `/zones/${zoneId}/email/routing/enable`);
      if (enable.success) {
        console.log("   Email Routing enabled successfully!");
        console.log("   (MX records have been added automatically)");
      } else {
        console.error("   Failed to enable Email Routing.");
        console.error("   You may need to enable it manually in the Cloudflare dashboard:");
        console.error(`   https://dash.cloudflare.com/${zoneId}/email/routing`);
      }
    }
  } else {
    console.log("   Could not check Email Routing status (may need dashboard setup first).");
    console.log(`   Dashboard: https://dash.cloudflare.com/${zoneId}/email/routing`);
  }

  // 3. Set catch-all rule
  console.log("\n4. Setting catch-all rule to route to Worker...");

  // First check current catch-all
  const currentCatchAll = await api("GET", `/zones/${zoneId}/email/routing/rules/catch_all`);
  if (currentCatchAll.success) {
    console.log("   Current catch-all:", JSON.stringify(currentCatchAll.result?.actions, null, 2));
  }

  const catchAll = await api("PUT", `/zones/${zoneId}/email/routing/rules/catch_all`, {
    actions: [{ type: "worker", value: [WORKER_NAME] }],
    matchers: [{ type: "all" }],
    enabled: true,
    name: "Route all email to brainstem Worker",
  });

  if (catchAll.success) {
    console.log(`   Catch-all rule set: *@${DOMAIN} → Worker ${WORKER_NAME}`);
  } else {
    console.error("   Failed to set catch-all rule.");
    console.error("   You may need to set it manually in the dashboard:");
    console.error(`   Email Routing > Routing rules > Catch-all > Send to Worker > ${WORKER_NAME}`);
  }

  // 4. Verify DNS records
  console.log("\n5. Checking DNS records...");
  const dns = await api("GET", `/zones/${zoneId}/dns_records?type=MX`);
  if (dns.success && dns.result?.length) {
    console.log("   MX records found:");
    for (const record of dns.result) {
      console.log(`   - ${record.name} → ${record.content} (priority: ${record.priority})`);
    }
  } else {
    console.log("   No MX records found. Email Routing may not be fully configured yet.");
  }

  console.log("\nSetup complete! Deploy the Worker with `npm run deploy` to enable the email handler.");
}

main().catch(err => {
  console.error("Script failed:", err);
  process.exit(1);
});
