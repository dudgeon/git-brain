// Test script for per-user MCP endpoint (authenticated)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_URL = "https://brainstem.cc/mcp/f7e4d8a2-1fb6-4352-8b63-bbfdf03b372a";
const BEARER_TOKEN = process.env.BRAINSTEM_TOKEN || "dd6946d2-3625-40f0-9d9c-f585ea7b29e8";

async function main() {
  console.log("Connecting to:", MCP_URL);

  const transport = new SSEClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
    },
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await client.connect(transport);
  console.log("Connected!");

  // Check server capabilities
  const serverInfo = client.getServerVersion();
  const serverCaps = client.getServerCapabilities();
  console.log("\n=== Server Info ===");
  console.log(JSON.stringify(serverInfo, null, 2));
  console.log("\n=== Server Capabilities ===");
  console.log(JSON.stringify(serverCaps, null, 2));

  const tools = await client.listTools();
  console.log("\n=== Available Tools ===");
  console.log(JSON.stringify(tools, null, 2));

  const prompts = await client.listPrompts();
  console.log("\n=== Available Prompts (Slash Commands) ===");
  console.log(JSON.stringify(prompts, null, 2));

  // Test about tool
  const aboutResult = await client.callTool({ name: "about", arguments: {} });
  console.log("\n=== About Tool Output ===");
  console.log(aboutResult.content[0].text);

  await client.close();
}

main().catch(console.error);
