import { existsSync, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

const dbModule = await import("../src/db.js")

const {
	getHourlyUsage,
	getRecentLogs,
	getUsageSummary,
	insertRequestLog,
	openUsageDatabase,
	pruneOldRequestLogs,
} = dbModule

type UsageDatabase = ReturnType<typeof openUsageDatabase>
type CountRow = { count: number }

type ReadStatement<T> = {
	get: (...params: unknown[]) => T | null
}

const readStatement = <T>(db: UsageDatabase, sql: string): ReadStatement<T> =>
	db.prepare(sql) as unknown as ReadStatement<T>

describe("dashboard usage database", () => {
	const originalCodexHome = process.env.CODEX_HOME
	let codexHome: string
	let db: UsageDatabase | undefined

	beforeEach(async () => {
		codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "openai-oauth-db-"))
		process.env.CODEX_HOME = codexHome
		db = undefined
	})

	afterEach(async () => {
		db?.close()
		db = undefined
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME
		} else {
			process.env.CODEX_HOME = originalCodexHome
		}
		await fs.rm(codexHome, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		})
	})

	test("creates the usage sqlite file under CODEX_HOME and stores request logs", () => {
		db = openUsageDatabase()

		insertRequestLog(db, {
			type: "chat_request",
			requestId: "req-1",
			path: "/v1/chat/completions?ignored=true",
			bodyKeys: ["model", "messages"],
			messageCount: 1,
			messageRoles: ["user"],
			model: "gpt-5.4-mini",
			stream: true,
			toolCount: 0,
		})

		expect(
			existsSync(path.join(codexHome, "openai-oauth", "usage.sqlite")),
		).toBe(true)

		const rows = getRecentLogs(db)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			type: "chat_request",
			requestId: "req-1",
			path: "/v1/chat/completions",
			model: "gpt-5.4-mini",
			status: null,
			durationMs: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			stream: true,
		})
	})

	test("prunes stale rows and aggregates retained usage", () => {
		db = openUsageDatabase()
		const now = new Date()
		const stale = new Date(now.getTime() - 25 * 60 * 60 * 1000)

		insertRequestLog(db, {
			type: "chat_request",
			requestId: "req-live",
			path: "/v1/chat/completions",
			bodyKeys: ["model"],
			messageCount: 1,
			messageRoles: ["user"],
			model: "gpt-5.5",
			stream: false,
			toolCount: 0,
		})
		insertRequestLog(db, {
			type: "chat_response",
			requestId: "req-live",
			path: "/v1/chat/completions",
			status: 200,
			stream: false,
			durationMs: 120,
			finishReason: "stop",
			usage: {
				inputTokens: 11,
				outputTokens: 7,
				totalTokens: 18,
			},
		})
		insertRequestLog(db, {
			type: "chat_error",
			requestId: "req-error",
			path: "/v1/chat/completions",
			durationMs: 30,
			message: "Upstream failed",
		})
		insertRequestLog(
			db,
			{
				type: "chat_response",
				requestId: "req-stale",
				path: "/v1/chat/completions",
				status: 200,
				stream: false,
				durationMs: 500,
				usage: {
					inputTokens: 100,
					outputTokens: 200,
					totalTokens: 300,
				},
			},
			{ timestamp: stale },
		)

		// Manually prune stale rows since automatic pruning on every operation is removed for latency optimization
		pruneOldRequestLogs(db)

		const summary = getUsageSummary(db)
		expect(summary).toEqual({
			requestCount: 1,
			responseCount: 1,
			errorCount: 1,
			totalInputTokens: 11,
			totalOutputTokens: 7,
			totalTokens: 18,
			totalDurationMs: 150,
			averageDurationMs: 150,
		})

		const hourly = getHourlyUsage(db)
		expect(hourly).toEqual([
			{
				hour: `${now.toISOString().slice(0, 13)}:00:00.000Z`,
				requestCount: 1,
				responseCount: 1,
				errorCount: 1,
				totalTokens: 18,
			},
		])

		const row = readStatement<CountRow>(
			db,
			"SELECT COUNT(*) AS count FROM request_logs WHERE request_id = ?",
		).get("req-stale")
		expect(row?.count).toBe(0)
	})

	test("uses zero defaults for missing usage", () => {
		db = openUsageDatabase()

		insertRequestLog(db, {
			type: "chat_response",
			requestId: "req-empty-usage",
			path: "/v1/chat/completions",
			status: 200,
			stream: false,
			durationMs: 10,
			usage: {},
		})

		expect(getUsageSummary(db)).toMatchObject({
			responseCount: 1,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalTokens: 0,
		})
		expect(getRecentLogs(db)[0]).toMatchObject({
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		})
	})

	test("recent logs do not serialize sensitive request data", () => {
		db = openUsageDatabase()

		insertRequestLog(db, {
			type: "chat_error",
			requestId: "req-sensitive",
			path: path.join(codexHome, "auth.json"),
			durationMs: 5,
			message: `access_token refresh_token auth.json ${codexHome} admin@example.com`,
		})

		const serialized = JSON.stringify(getRecentLogs(db))
		expect(serialized).not.toContain("access_token")
		expect(serialized).not.toContain("refresh_token")
		expect(serialized).not.toContain("auth.json")
		expect(serialized).not.toContain(codexHome)
		expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
	})
})
