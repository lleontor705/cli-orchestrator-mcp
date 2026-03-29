import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrchestratorTools } from "./tools/orchestrator.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "cli-orchestrator-mcp",
    version: "1.0.0",
  });

  registerOrchestratorTools(server);

  return server;
}
