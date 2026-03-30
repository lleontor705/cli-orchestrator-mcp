import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrchestratorTools } from "./tools/orchestrator.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export function createServer(): McpServer {
  const server = new McpServer({
    name: "cli-orchestrator-mcp",
    version,
  });

  registerOrchestratorTools(server);

  return server;
}
