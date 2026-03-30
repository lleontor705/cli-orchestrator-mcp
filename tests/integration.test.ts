import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

describe("MCP Integration", () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    const server = createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    clientTransport = ct;
    serverTransport = st;

    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await clientTransport.close();
    await serverTransport.close();
  });

  it("lists exactly 4 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["cli_execute", "cli_list", "cli_route", "cli_stats"]);
  });

  it("cli_stats returns all 3 providers with expected fields", async () => {
    const result = await client.callTool({ name: "cli_stats", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.providers).toBeDefined();
    for (const provider of ["claude", "gemini", "codex"]) {
      const p = data.providers[provider];
      expect(p).toBeDefined();
      expect(typeof p.installed).toBe("boolean");
      expect(p.circuit_breaker).toBeDefined();
      expect(typeof p.total_executions).toBe("number");
      expect(typeof p.total_failures).toBe("number");
      expect(Array.isArray(p.strengths)).toBe(true);
    }
  });

  it("cli_list returns installed_count and providers array", async () => {
    const result = await client.callTool({ name: "cli_list", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(typeof data.installed_count).toBe("number");
    expect(Array.isArray(data.providers)).toBe(true);
  });

  it("cli_route with role developer returns recommendation with fallback_chain", async () => {
    const result = await client.callTool({
      name: "cli_route",
      arguments: { role: "developer" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.role).toBe("developer");
    expect(data.recommended_cli).toBeDefined();
    expect(Array.isArray(data.fallback_chain)).toBe(true);
    expect(data.fallback_chain.length).toBeGreaterThan(0);
    expect(data.availability).toBeDefined();
  });

  it("cli_route with role researcher returns recommendation", async () => {
    const result = await client.callTool({
      name: "cli_route",
      arguments: { role: "researcher", task_description: "API docs lookup" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.role).toBe("researcher");
    expect(data.recommended_cli).toBeDefined();
    expect(data.reasoning).toBeTruthy();
    expect(data.task_description).toBe("API docs lookup");
  });

  it("cli_execute with a non-installed CLI returns error gracefully", async () => {
    // This test relies on the fact that at least one of these CLIs is not installed,
    // or the circuit breaker / detection handles it gracefully.
    // We use allow_fallback=false to prevent fallback and a short timeout.
    const result = await client.callTool({
      name: "cli_execute",
      arguments: {
        cli: "codex",
        prompt: "test prompt",
        mode: "analyze",
        timeout_seconds: 10,
        allow_fallback: false,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const data = JSON.parse(text);
    // Whether success or failure, we should get a well-formed response
    expect(typeof data.success).toBe("boolean");
    expect(data.provider).toBeDefined();
    expect(typeof data.duration_ms).toBe("number");
  }, 30000);
});
