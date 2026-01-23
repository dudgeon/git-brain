// Quick test script to connect to the MCP server and list tools
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const SERVER_URL = "https://home-brain-mcp.dudgeon.workers.dev/mcp";

async function testServer() {
  console.log("Connecting to:", SERVER_URL);

  try {
    const transport = new SSEClientTransport(new URL(SERVER_URL));
    const client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    await client.connect(transport);
    console.log("Connected!");

    // List tools
    const tools = await client.listTools();
    console.log("\n=== Available Tools ===");
    console.log(JSON.stringify(tools, null, 2));

    await client.close();
  } catch (error) {
    console.error("Error:", error.message);
    if (error.cause) {
      console.error("Cause:", error.cause);
    }
  }
}

testServer();
