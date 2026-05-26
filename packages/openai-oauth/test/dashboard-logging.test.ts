import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getUsageSummary, openUsageDatabase } from "../src/db.js"
import { createRequestLogger } from "../src/logging.js"
import type { OpenAIOAuthServerOptions } from "../src/types.js"

describe("dashboard-logging", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(tmpdir(), "openai-oauth-test-"))
		process.env.CODEX_HOME = tempDir
	})

	afterEach(() => {
		delete process.env.CODEX_HOME
		if (existsSync(tempDir)) {
			try {
				rmSync(tempDir, { recursive: true, force: true })
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!("code" in error) ||
					error.code !== "EBUSY"
				)
					throw error
				// On Windows, SQLite might still have a lock.
				// We ignore EBUSY in tests to allow the test suite to continue.
			}
		}
	})

	it("should compose multiple loggers and persist to SQLite", () => {
		const userLogger = vi.fn()
		const settings: OpenAIOAuthServerOptions = {
			requestLogger: userLogger,
		}

		const logger = createRequestLogger(settings)
		if (!logger) throw new Error("expected request logger")

		const requestId = "test-request-id"
		logger({
			type: "chat_request",
			requestId,
			path: "/v1/chat/completions",
			model: "gpt-4",
			messageCount: 1,
			messageRoles: ["user"],
			stream: false,
			toolCount: 0,
			bodyKeys: ["model", "messages"],
		})

		// Verify user logger was called
		expect(userLogger).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "chat_request",
				requestId,
			}),
		)

		// Flush asynchronous queue to persist to SQLite
		logger.flush?.()

		// Verify SQLite persistence
		const db = openUsageDatabase()
		const summary = getUsageSummary(db)
		expect(summary.requestCount).toBe(1)
		db.close()
	})

	it("should handle logger failures gracefully", () => {
		const failingLogger = vi.fn().mockImplementation(() => {
			throw new Error("Logger failed")
		})
		const settings: OpenAIOAuthServerOptions = {
			requestLogger: failingLogger,
		}

		const logger = createRequestLogger(settings)
		if (!logger) throw new Error("expected request logger")
		expect(() => {
			logger({
				type: "chat_request",
				requestId: "test-id",
				path: "/test",
				messageCount: 0,
				messageRoles: [],
				stream: false,
				toolCount: 0,
				bodyKeys: [],
			})
		}).not.toThrow()

		expect(failingLogger).toHaveBeenCalled()
	})

	it("should respect CODEX_OPENAI_SERVER_LOG_REQUESTS for console logging", () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		process.env.CODEX_OPENAI_SERVER_LOG_REQUESTS = "1"

		const logger = createRequestLogger({})
		if (!logger) throw new Error("expected request logger")
		logger({
			type: "chat_request",
			requestId: "test-id",
			path: "/test",
			messageCount: 0,
			messageRoles: [],
			stream: false,
			toolCount: 0,
			bodyKeys: [],
		})

		expect(consoleSpy).toHaveBeenCalled()
		const logCall = JSON.parse(consoleSpy.mock.calls[0][0])
		expect(logCall.requestId).toBe("test-id")

		delete process.env.CODEX_OPENAI_SERVER_LOG_REQUESTS
		consoleSpy.mockRestore()
	})
})
