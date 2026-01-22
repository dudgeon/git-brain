import { Hono } from 'hono';

// Define the environment bindings that will be available when deployed
export interface Env {
  // These will be uncommented when infrastructure is set up
  // R2: R2Bucket;
  // AI: Ai;
  // AUTORAG_NAME: string;
}

const app = new Hono<{ Bindings: Env }>();

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    name: 'home-brain-mcp',
    version: '1.0.0',
    status: 'ok',
    message: 'MCP server for home-brain knowledge base'
  });
});

// MCP SSE endpoint (to be implemented)
app.get('/sse', (c) => {
  return c.json({
    error: 'MCP SSE endpoint not yet implemented',
    message: 'This endpoint will handle MCP protocol over Server-Sent Events'
  }, 501);
});

// MCP POST endpoint (to be implemented)
app.post('/mcp', (c) => {
  return c.json({
    error: 'MCP POST endpoint not yet implemented',
    message: 'This endpoint will handle MCP protocol over HTTP POST'
  }, 501);
});

export default app;
