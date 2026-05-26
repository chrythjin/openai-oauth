import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createOpenAIOAuthFetchHandler } from "../src/index.js"

const createAuthFile = async (): Promise<string> => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "openai-oauth-server-"))
	const authPath = path.join(root, "auth.json")
	await fs.writeFile(
		authPath,
		JSON.stringify(
			{
				tokens: {
					access_token: "access-token",
					account_id: "acct-1",
				},
			},
			null,
			2,
		),
		"utf-8",
	)
	return authPath
}

describe("openai oauth server", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("lists configured models", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-5.2", "gpt-5.4-mini", "gpt-5.1-codex"],
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			object: "list",
			data: [
				{
					id: "gpt-5.2",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-minimal",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-low",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-medium",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-high",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-xhigh",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.4-mini",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.4-mini-minimal",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.4-mini-low",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.4-mini-medium",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.4-mini-high",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.4-mini-xhigh",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.1-codex",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
			],
		})
	})

	test("maps responses model aliases to upstream reasoning effort", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					[
						"event: response.completed",
						'data: {"response":{"id":"resp_1","status":"completed"}}',
						"",
					].join("\n"),
					{ status: 200 },
				),
		)
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.4-mini-xhigh",
					input: "hello",
				}),
			}),
		)

		expect(response.status).toBe(200)
		expect(fetch).toHaveBeenCalled()
		const call = fetch.mock.calls[0]
		expect(call).toBeDefined()
		const upstreamBody = JSON.parse(call?.[1]?.body as string)
		expect(upstreamBody.model).toBe("gpt-5.4-mini")
		expect(upstreamBody.reasoning).toEqual({ effort: "xhigh" })

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("loads account models from codex when no override is configured", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			expect(String(input)).toContain(
				"/backend-api/codex/models?client_version=",
			)
			return new Response(
				JSON.stringify({
					models: [
						{ slug: "gpt-5.2" },
						{ slug: "gpt-5.1-codex" },
						{ slug: "gpt-5.2" },
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				},
			)
		})
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(200)
		expect(fetch).toHaveBeenCalledTimes(1)
		await expect(response.json()).resolves.toEqual({
			object: "list",
			data: [
				{
					id: "gpt-5.2",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-minimal",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-low",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-medium",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-high",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.2-xhigh",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.1-codex",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
			],
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("returns an upstream error when codex model discovery fails", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						detail: "This account does not support codex model discovery.",
					}),
					{
						status: 403,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
		)
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toEqual({
			error: {
				message: "This account does not support codex model discovery.",
				type: "upstream_error",
			},
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("reports the replay state mode in health", async () => {
		const handler = createOpenAIOAuthFetchHandler()
		const health = await handler(
			new Request("http://localhost/health", {
				method: "GET",
			}),
		)

		await expect(health.json()).resolves.toEqual({
			ok: true,
			replay_state: "stateless",
		})
	})

	test("aggregates streaming responses requests into json when stream is false", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) => {
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								[
									"event: response.created",
									'data: {"response":{"id":"resp_1","status":"in_progress"}}',
									"",
									"event: response.completed",
									'data: {"response":{"id":"resp_1","status":"completed","output":[{"type":"message"}]}}',
									"",
								].join("\n"),
							),
						)
						controller.close()
					},
				})

				return new Response(stream, { status: 200 })
			},
		)

		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
			instructions: "server-instructions",
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					max_output_tokens: 5,
				}),
			}),
		)

		expect(fetch).toHaveBeenCalledTimes(1)
		const call = fetch.mock.calls[0]
		expect(call).toBeDefined()
		expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
			model: "gpt-5.2",
			stream: true,
			instructions: "server-instructions",
		})

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			id: "resp_1",
			status: "completed",
			output: [{ type: "message" }],
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("rejects previous_response_id on the stateless responses endpoint", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					previous_response_id: "resp_1",
					input: [],
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(fetch).not.toHaveBeenCalled()
	})

	test("emits a chat error log when messages is invalid", async () => {
		const requestLogger = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			requestLogger,
		})

		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.4",
					messages: "not-an-array",
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(requestLogger).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "chat_error",
				path: "/v1/chat/completions",
				message: "`messages` must be an array.",
			}),
		)
	})
})
