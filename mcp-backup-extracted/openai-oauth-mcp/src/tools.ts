import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { JsonObject, ProxyManager } from "./proxy-manager.js"

const formatStructuredContent = (value: unknown): string =>
	JSON.stringify(value, null, 2)

const toToolErrorResult = (error: unknown) => ({
	content: [
		{
			type: "text" as const,
			text: error instanceof Error ? error.message : String(error),
		},
	],
	isError: true,
})

export const registerTools = (
	server: McpServer,
	proxyManager: ProxyManager,
): void => {
	server.registerTool(
		"start_proxy",
		{
			title: "Start openai-oauth proxy",
			description:
				"Start the local openai-oauth proxy with `bun run dev` on port 10531 after confirming auth.json exists.",
			inputSchema: z.object({}),
			outputSchema: z.object({
				status: z.literal("running"),
				port: z.number(),
			}),
			annotations: {
				idempotentHint: true,
			},
		},
		async () => {
			try {
				const result = await proxyManager.start()
				return {
					content: [{ type: "text" as const, text: formatStructuredContent(result) }],
					structuredContent: result,
				}
			} catch (error) {
				return toToolErrorResult(error)
			}
		},
	)

	server.registerTool(
		"stop_proxy",
		{
			title: "Stop openai-oauth proxy",
			description: "Stop the managed openai-oauth proxy child process.",
			inputSchema: z.object({}),
			outputSchema: z.object({
				status: z.literal("stopped"),
			}),
			annotations: {
				idempotentHint: true,
			},
		},
		async () => {
			try {
				const result = await proxyManager.stop()
				return {
					content: [{ type: "text" as const, text: formatStructuredContent(result) }],
					structuredContent: result,
				}
			} catch (error) {
				return toToolErrorResult(error)
			}
		},
	)

	server.registerTool(
		"proxy_status",
		{
			title: "Read proxy status",
			description:
				"Report whether the local proxy is reachable, which port it uses, and whether auth.json can be discovered.",
			inputSchema: z.object({}),
			outputSchema: z.object({
				running: z.boolean(),
				port: z.number(),
				hasAuth: z.boolean(),
			}),
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
			},
		},
		async () => {
			try {
				const result = await proxyManager.status()
				return {
					content: [{ type: "text" as const, text: formatStructuredContent(result) }],
					structuredContent: result,
				}
			} catch (error) {
				return toToolErrorResult(error)
			}
		},
	)

	server.registerTool(
		"chatgpt_complete",
		{
			title: "Create chat completion through proxy",
			description:
				"Send an OpenAI-compatible chat completion request through the local openai-oauth proxy.",
			inputSchema: z.object({
				model: z.string().min(1),
				messages: z
					.array(
						z.object({
							role: z.string().min(1),
							content: z.string(),
						}),
					)
					.min(1),
				temperature: z.number().min(0).max(2).optional(),
			}),
			outputSchema: z.object({}).passthrough(),
		},
		async (input) => {
			try {
				const requestBody: JsonObject = {
					model: input.model,
					messages: input.messages.map((message) => ({
						role: message.role,
						content: message.content,
					})),
				}

				if (typeof input.temperature === "number") {
					requestBody.temperature = input.temperature
				}

				const result = await proxyManager.chatCompletion(requestBody)
				return {
					content: [{ type: "text" as const, text: formatStructuredContent(result) }],
					structuredContent: result,
				}
			} catch (error) {
				return toToolErrorResult(error)
			}
		},
	)
}
