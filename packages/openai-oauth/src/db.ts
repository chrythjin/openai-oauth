import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import path from "node:path"

import type { OpenAIOAuthServerLogEvent } from "./types.js"

const RETENTION_MS = 24 * 60 * 60 * 1000

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS request_logs (
	id TEXT PRIMARY KEY,
	timestamp TEXT NOT NULL,
	type TEXT NOT NULL,
	request_id TEXT NOT NULL,
	path TEXT NOT NULL,
	model TEXT NULL,
	status INTEGER NULL,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	input_tokens INTEGER NOT NULL DEFAULT 0,
	output_tokens INTEGER NOT NULL DEFAULT 0,
	total_tokens INTEGER NOT NULL DEFAULT 0,
	error_message TEXT NULL,
	stream INTEGER NOT NULL DEFAULT 0
)
`

const CREATE_INDEXES_SQL = [
	"CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs (timestamp)",
	"CREATE INDEX IF NOT EXISTS idx_request_logs_request_id ON request_logs (request_id)",
	"CREATE INDEX IF NOT EXISTS idx_request_logs_type ON request_logs (type)",
] as const

export type UsageDatabase = Database

export const REQUEST_LOG_RETENTION_MS = RETENTION_MS

export type RequestLogRow = {
	id: string
	timestamp: string
	type: OpenAIOAuthServerLogEvent["type"]
	requestId: string
	path: string
	model: string | null
	status: number | null
	durationMs: number
	inputTokens: number
	outputTokens: number
	totalTokens: number
	errorMessage: string | null
	stream: boolean
}

export type InsertRequestLogOptions = {
	timestamp?: Date | string
}

export type UsageSummary = {
	requestCount: number
	responseCount: number
	errorCount: number
	totalInputTokens: number
	totalOutputTokens: number
	totalTokens: number
	totalDurationMs: number
	averageDurationMs: number
}

export type HourlyUsage = {
	hour: string
	requestCount: number
	responseCount: number
	errorCount: number
	totalTokens: number
}

type StoredRequestLogRow = {
	id: string
	timestamp: string
	type: OpenAIOAuthServerLogEvent["type"]
	request_id: string
	path: string
	model: string | null
	status: number | null
	duration_ms: number
	input_tokens: number
	output_tokens: number
	total_tokens: number
	error_message: string | null
	stream: number
}

type SummaryRow = {
	request_count: number | null
	response_count: number | null
	error_count: number | null
	total_input_tokens: number | null
	total_output_tokens: number | null
	total_tokens: number | null
	total_duration_ms: number | null
}

type HourlyUsageRow = {
	hour: string
	request_count: number | null
	response_count: number | null
	error_count: number | null
	total_tokens: number | null
}

type ReadStatement<T> = {
	get: (...params: unknown[]) => T | null
	all: (...params: unknown[]) => T[]
}

const readStatement = <T>(db: UsageDatabase, sql: string): ReadStatement<T> =>
	db.prepare(sql) as unknown as ReadStatement<T>

const toFiniteInteger = (value: number | undefined): number =>
	typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0

const toNullableInteger = (value: number | undefined): number | null =>
	typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null

const toIsoTimestamp = (timestamp: Date | string | undefined): string => {
	if (timestamp instanceof Date) {
		return timestamp.toISOString()
	}

	if (typeof timestamp === "string") {
		const parsed = new Date(timestamp)
		if (!Number.isNaN(parsed.getTime())) {
			return parsed.toISOString()
		}
	}

	return new Date().toISOString()
}

const redactSensitiveText = (value: string | undefined): string | null => {
	if (!value) {
		return null
	}

	return value
		.replace(
			/\b(access_token|refresh_token|authorization|bearer)\b/gi,
			"[redacted]",
		)
		.replace(/auth\.json/gi, "[redacted-auth-file]")
		.replace(/[A-Z]:\\[^\s]+/gi, "[redacted-path]")
		.replace(/(?:^|\s)(?:~|\.{1,2})?[/\\][^\s]+/g, " [redacted-path]")
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
}

const sanitizePath = (pathValue: string): string => {
	if (!pathValue.startsWith("/")) {
		return "unknown"
	}

	return pathValue.split("?")[0] || "unknown"
}

const resolveCodexHome = (): string => {
	const configured = process.env.CODEX_HOME
	if (configured) {
		return configured
	}

	const home = process.env.USERPROFILE || process.env.HOME
	if (!home) {
		throw new Error("Unable to resolve CODEX_HOME or a user home directory.")
	}

	return path.join(home, ".codex")
}

const resolveDatabasePath = (): string => {
	const databaseDir = path.join(resolveCodexHome(), "openai-oauth")
	mkdirSync(databaseDir, { recursive: true })
	return path.join(databaseDir, "usage.sqlite")
}

const cutoffTimestamp = (): string =>
	new Date(Date.now() - RETENTION_MS).toISOString()

const mapStoredRow = (row: StoredRequestLogRow): RequestLogRow => ({
	id: row.id,
	timestamp: row.timestamp,
	type: row.type,
	requestId: row.request_id,
	path: row.path,
	model: row.model,
	status: row.status,
	durationMs: row.duration_ms,
	inputTokens: row.input_tokens,
	outputTokens: row.output_tokens,
	totalTokens: row.total_tokens,
	errorMessage: row.error_message,
	stream: row.stream === 1,
})

export const pruneOldRequestLogs = (db: UsageDatabase): void => {
	db.prepare("DELETE FROM request_logs WHERE timestamp < ?").run(
		cutoffTimestamp(),
	)
}

export const openUsageDatabase = (): UsageDatabase => {
	const db = new Database(resolveDatabasePath())
	db.exec("PRAGMA busy_timeout = 5000")
	db.exec("PRAGMA journal_mode = WAL")
	db.exec(CREATE_TABLE_SQL)
	for (const indexSql of CREATE_INDEXES_SQL) {
		db.exec(indexSql)
	}
	return db
}

export const insertRequestLog = (
	db: UsageDatabase,
	event: OpenAIOAuthServerLogEvent,
	options: InsertRequestLogOptions = {},
): void => {
	const timestamp = toIsoTimestamp(options.timestamp)
	const inputTokens =
		event.type === "chat_response"
			? toFiniteInteger(event.usage.inputTokens)
			: 0
	const outputTokens =
		event.type === "chat_response"
			? toFiniteInteger(event.usage.outputTokens)
			: 0
	const totalTokens =
		event.type === "chat_response"
			? toFiniteInteger(event.usage.totalTokens)
			: 0

	db.prepare(
		`INSERT INTO request_logs (
			id,
			timestamp,
			type,
			request_id,
			path,
			model,
			status,
			duration_ms,
			input_tokens,
			output_tokens,
			total_tokens,
			error_message,
			stream
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		crypto.randomUUID(),
		timestamp,
		event.type,
		event.requestId,
		sanitizePath(event.path),
		event.type === "chat_request" ? (event.model ?? null) : null,
		event.type === "chat_response" ? toNullableInteger(event.status) : null,
		event.type === "chat_request" ? 0 : toFiniteInteger(event.durationMs),
		inputTokens,
		outputTokens,
		totalTokens,
		event.type === "chat_error" ? redactSensitiveText(event.message) : null,
		event.type === "chat_error" ? 0 : event.stream ? 1 : 0,
	)
}

export const getUsageSummary = (db: UsageDatabase): UsageSummary => {
	const row = readStatement<SummaryRow>(
		db,
		`SELECT
				SUM(CASE WHEN type = 'chat_request' THEN 1 ELSE 0 END) AS request_count,
				SUM(CASE WHEN type = 'chat_response' THEN 1 ELSE 0 END) AS response_count,
				SUM(CASE WHEN type = 'chat_error' THEN 1 ELSE 0 END) AS error_count,
				SUM(input_tokens) AS total_input_tokens,
				SUM(output_tokens) AS total_output_tokens,
				SUM(total_tokens) AS total_tokens,
				SUM(duration_ms) AS total_duration_ms
			FROM request_logs`,
	).get()

	const responseCount = row?.response_count ?? 0
	const totalDurationMs = row?.total_duration_ms ?? 0

	return {
		requestCount: row?.request_count ?? 0,
		responseCount,
		errorCount: row?.error_count ?? 0,
		totalInputTokens: row?.total_input_tokens ?? 0,
		totalOutputTokens: row?.total_output_tokens ?? 0,
		totalTokens: row?.total_tokens ?? 0,
		totalDurationMs,
		averageDurationMs:
			responseCount > 0 ? Math.round(totalDurationMs / responseCount) : 0,
	}
}

export const getHourlyUsage = (db: UsageDatabase): HourlyUsage[] => {
	return readStatement<HourlyUsageRow>(
		db,
		`SELECT
					substr(timestamp, 1, 13) || ':00:00.000Z' AS hour,
					SUM(CASE WHEN type = 'chat_request' THEN 1 ELSE 0 END) AS request_count,
					SUM(CASE WHEN type = 'chat_response' THEN 1 ELSE 0 END) AS response_count,
					SUM(CASE WHEN type = 'chat_error' THEN 1 ELSE 0 END) AS error_count,
					SUM(total_tokens) AS total_tokens
				FROM request_logs
				GROUP BY hour
				ORDER BY hour ASC`,
	)
		.all()
		.map((row) => ({
			hour: row.hour,
			requestCount: row.request_count ?? 0,
			responseCount: row.response_count ?? 0,
			errorCount: row.error_count ?? 0,
			totalTokens: row.total_tokens ?? 0,
		}))
}

export const getRecentLogs = (
	db: UsageDatabase,
	limit = 50,
): RequestLogRow[] => {
	const normalizedLimit = Math.max(0, Math.min(500, Math.trunc(limit)))
	return readStatement<StoredRequestLogRow>(
		db,
		`SELECT
					id,
					timestamp,
					type,
					request_id,
					path,
					model,
					status,
					duration_ms,
					input_tokens,
					output_tokens,
					total_tokens,
					error_message,
					stream
				FROM request_logs
				ORDER BY timestamp DESC
				LIMIT ?`,
	)
		.all(normalizedLimit)
		.map(mapStoredRow)
}
