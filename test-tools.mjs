// Test script to verify all MCP tools work
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const SERVER_URL = "https://home-brain-mcp.dudgeon.workers.dev/mcp";

async function testTools() {
  console.log("Connecting to:", SERVER_URL);

  const transport = new SSEClientTransport(new URL(SERVER_URL));
  const client = new Client({
    name: "test-client",
    version: "1.0.0",
  });

  await client.connect(transport);
  console.log("Connected!\n");

  // Test 1: list_folders (root)
  console.log("=== Test: list_folders (root) ===");
  try {
    const result = await client.callTool({ name: "list_folders", arguments: { path: "" } });
    console.log(result.content[0].text.slice(0, 500) + "...\n");
  } catch (e) {
    console.log("Error:", e.message, "\n");
  }

  // Test 2: list_recent
  console.log("=== Test: list_recent (limit 3) ===");
  try {
    const result = await client.callTool({ name: "list_recent", arguments: { limit: 3 } });
    console.log(result.content[0].text + "\n");
  } catch (e) {
    console.log("Error:", e.message, "\n");
  }

  // Test 3: get_document
  console.log("=== Test: get_document (README.md) ===");
  try {
    const result = await client.callTool({ name: "get_document", arguments: { path: "README.md" } });
    console.log(result.content[0].text.slice(0, 500) + "...\n");
  } catch (e) {
    console.log("Error:", e.message, "\n");
  }

  // Test 4: search_brain
  console.log("=== Test: search_brain ===");
  try {
    const result = await client.callTool({ name: "search_brain", arguments: { query: "family", limit: 2 } });
    console.log(result.content[0].text.slice(0, 800) + "...\n");
  } catch (e) {
    console.log("Error:", e.message, "\n");
  }

  await client.close();
  console.log("All tests complete!");
}

testTools().catch(console.error);
