#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import packageJson from "../package.json" with { type: "json" }
import { ProxyManager } from "./proxy-manager.js"
import { registerTools } from "./tools.js"

const proxyManager = new ProxyManager()

const server = new McpServer(
	{
		name: packageJson.name,
		version: packageJson.version,
	},
	{
		instructions:
			"Manage the local openai-oauth proxy over MCP. Start the proxy before calling chatgpt_complete if it is not already running.",
	},
)

registerTools(server, proxyManager)

const shutdown = async (): Promise<void> => {
	try {
		await proxyManager.stop()
	} catch (error) {
		console.error(
			error instanceof Error
				? `Failed to stop proxy during shutdown: ${error.message}`
				: `Failed to stop proxy during shutdown: ${String(error)}`,
		)
	}
}

const main = async (): Promise<void> => {
	// Auto-start proxy on MCP server initialization
	try {
		const status = await proxyManager.start()
		console.error(`Proxy auto-started on port ${status.port}`)
	} catch (error) {
		console.error(
			`Failed to auto-start proxy: ${error instanceof Error ? error.message : String(error)}`,
		)
		// Continue anyway - proxy can be started manually later
	}

	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error(`${packageJson.name} running on stdio`)

	const handleSignal = (signal: NodeJS.Signals) => {
		void shutdown().finally(() => {
			process.exit(signal === "SIGINT" ? 130 : 0)
		})
	}

	process.on("SIGINT", () => {
		handleSignal("SIGINT")
	})

	process.on("SIGTERM", () => {
		handleSignal("SIGTERM")
	})
}

void main().catch(async (error) => {
	await shutdown()
	console.error(
		error instanceof Error
			? `Fatal error in openai-oauth-mcp: ${error.message}`
			: `Fatal error in openai-oauth-mcp: ${String(error)}`,
	)
	process.exit(1)
})
