import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { handleDashboardApiRequest } from "../src/dashboard-api.js"
import { insertRequestLog, openUsageDatabase } from "../src/db.js"

describe("dashboard-api", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(tmpdir(), "openai-oauth-api-test-"))
		process.env.CODEX_HOME = tempDir
	})

	afterEach(() => {
		delete process.env.CODEX_HOME
		if (existsSync(tempDir)) {
			try {
				rmSync(tempDir, { recursive: true, force: true })
			} catch (e: any) {
				if (e.code !== "EBUSY") throw e
			}
		}
	})

	it("should return real summary data from SQLite", async () => {
		const db = openUsageDatabase()
		const requestId = "test-id"

		insertRequestLog(db, {
			type: "chat_request",
			requestId,
			path: "/v1/chat/completions",
			model: "gpt-4",
			messageCount: 1,
			messageRoles: ["user"],
			stream: false,
			toolCount: 0,
			bodyKeys: [],
		})

		insertRequestLog(db, {
			type: "chat_response",
			requestId,
			path: "/v1/chat/completions",
			status: 200,
			stream: false,
			durationMs: 100,
			usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
		})
		db.close()

		const request = new Request("http://localhost/api/dashboard/summary")
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		const data = await response.json()

		expect(data).toEqual(
			expect.objectContaining({
				totalRequests: 1,
				totalTokens: 30,
				errorCount: 0,
			}),
		)
		expect(typeof data.uptime).toBe("string")
	})

	it("should return recent logs in LogEntry format", async () => {
		const db = openUsageDatabase()
		const requestId = "log-test-id"

		insertRequestLog(db, {
			type: "chat_request",
			requestId,
			path: "/v1/chat/completions",
			model: "gpt-4",
			messageCount: 1,
			messageRoles: ["user"],
			stream: false,
			toolCount: 0,
			bodyKeys: [],
		})
		db.close()

		const request = new Request("http://localhost/api/dashboard/logs")
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		const logs = await response.json()

		expect(logs).toHaveLength(1)
		expect(logs[0]).toEqual(
			expect.objectContaining({
				type: "chat_request",
				path: "/v1/chat/completions",
				model: "gpt-4",
			}),
		)
	})

	it("should return status with active token info", async () => {
		const request = new Request("http://localhost/api/dashboard/status")
		const response = await handleDashboardApiRequest(request, () => {}, {
			port: 10531,
		} as any)
		const data = await response.json()

		expect(data).toHaveProperty("healthy")
		expect(data).toHaveProperty("uptime")
		expect(data).toHaveProperty("active_token")
	})

	it("should return hourly stats in buckets", async () => {
		const db = openUsageDatabase()
		insertRequestLog(db, {
			type: "chat_request",
			requestId: "h1",
			path: "/test",
			messageCount: 0,
			messageRoles: [],
			stream: false,
			toolCount: 0,
			bodyKeys: [],
		})
		db.close()

		const request = new Request("http://localhost/api/dashboard/hourly")
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		const hourly = await response.json()

		expect(Array.isArray(hourly)).toBe(true)
		if (hourly.length > 0) {
			expect(hourly[0]).toHaveProperty("hour")
			expect(hourly[0]).toHaveProperty("requests")
			expect(hourly[0]).toHaveProperty("tokens")
		}
	})

	it("should not emit wildcard CORS on summary route", async () => {
		const request = new Request("http://localhost/api/dashboard/summary")
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		expect(response.headers.get("access-control-allow-origin")).not.toBe("*")
	})

	it("should not emit wildcard CORS on logs route", async () => {
		const request = new Request("http://localhost/api/dashboard/logs")
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		expect(response.headers.get("access-control-allow-origin")).not.toBe("*")
	})

	it("should not emit wildcard CORS on status route", async () => {
		const request = new Request("http://localhost/api/dashboard/status")
		const response = await handleDashboardApiRequest(request, () => {}, {
			port: 10531,
		} as any)
		expect(response.headers.get("access-control-allow-origin")).not.toBe("*")
	})

	it("should not emit wildcard CORS on hourly route", async () => {
		const request = new Request("http://localhost/api/dashboard/hourly")
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		expect(response.headers.get("access-control-allow-origin")).not.toBe("*")
	})

	it("should not emit wildcard CORS on 404 route", async () => {
		const request = new Request("http://localhost/api/dashboard/unknown")
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		expect(response.headers.get("access-control-allow-origin")).not.toBe("*")
	})

	it("should handle OPTIONS with localhost-only CORS", async () => {
		const request = new Request(
			"http://localhost:10531/api/dashboard/summary",
			{
				method: "OPTIONS",
				headers: { origin: "http://127.0.0.1:10531" },
			},
		)
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		expect(response.status).toBe(204)
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"http://127.0.0.1:10531",
		)
		expect(response.headers.get("access-control-allow-methods")).toBe(
			"GET,OPTIONS",
		)
	})

	it("should fallback to localhost origin when no origin header on OPTIONS", async () => {
		const request = new Request(
			"http://localhost:10531/api/dashboard/summary",
			{
				method: "OPTIONS",
			},
		)
		const response = await handleDashboardApiRequest(
			request,
			() => {},
			{} as any,
		)
		expect(response.status).toBe(204)
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"http://127.0.0.1:10531",
		)
	})
})
