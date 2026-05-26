import { Database } from "bun:sqlite"

import type { OpenAIOAuthServerLogEvent } from "./types.js"

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS request_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	timestamp TEXT DEFAULT (datetime('now')),
	model TEXT,
	tokens_in INTEGER,
	tokens_out INTEGER,
	reasoning_tokens INTEGER,
	duration_ms INTEGER,
	finish_reason TEXT,
	stream INTEGER,
	status INTEGER,
	request_id TEXT
)
`

const INSERT_LOG_SQL = `
INSERT INTO request_logs (
	model,
	tokens_in,
	tokens_out,
	reasoning_tokens,
	duration_ms,
	finish_reason,
	stream,
	status,
	request_id
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const PRUNE_LOGS_SQL = `
DELETE FROM request_logs
WHERE CAST(strftime('%s', timestamp) AS INTEGER) * 1000 < ?
`

let activeDb: Database | null = null

const ensureActiveDb = (): Database => {
	if (!activeDb) {
		throw new Error("SQLite logger has not been initialized.")
	}

	return activeDb
}

const toNullableInteger = (value: number | undefined): number | null =>
	typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null

const toStreamValue = (stream: boolean | undefined): number | null =>
	typeof stream === "boolean" ? (stream ? 1 : 0) : null

const mapEventToRow = (event: OpenAIOAuthServerLogEvent) => {
	if (event.type === "chat_request") {
		return {
			model: event.model ?? null,
			tokens_in: null,
			tokens_out: null,
			reasoning_tokens: null,
			duration_ms: null,
			finish_reason: null,
			stream: toStreamValue(event.stream),
			status: null,
			request_id: event.requestId,
		}
	}

	if (event.type === "chat_response") {
		return {
			model: null,
			tokens_in: toNullableInteger(event.usage.inputTokens),
			tokens_out: toNullableInteger(event.usage.outputTokens),
			reasoning_tokens: toNullableInteger(event.usage.reasoningTokens),
			duration_ms: toNullableInteger(event.durationMs),
			finish_reason: event.finishReason ?? null,
			stream: toStreamValue(event.stream),
			status: toNullableInteger(event.status),
			request_id: event.requestId,
		}
	}

	return {
		model: null,
		tokens_in: null,
		tokens_out: null,
		reasoning_tokens: null,
		duration_ms: toNullableInteger(event.durationMs),
		finish_reason: null,
		stream: null,
		status: 500,
		request_id: event.requestId,
	}
}

const persistLogEvent = (db: Database, event: OpenAIOAuthServerLogEvent) => {
	const row = mapEventToRow(event)
	db.prepare(INSERT_LOG_SQL).run(
		row.model,
		row.tokens_in,
		row.tokens_out,
		row.reasoning_tokens,
		row.duration_ms,
		row.finish_reason,
		row.stream,
		row.status,
		row.request_id,
	)
}

export function initDb(): void
export function initDb(db: Database): void
export function initDb(db?: Database): void {
	const database = db ?? ensureActiveDb()
	database.exec(CREATE_TABLE_SQL)
}

export const createSqliteLogger = (dbPath: string) => {
	const db = new Database(dbPath)
	activeDb = db
	initDb(db)

	return (event: OpenAIOAuthServerLogEvent) => {
		persistLogEvent(db, event)
	}
}

export const pruneOldLogs = (maxAgeMs: number) => {
	const cutoffMs = Date.now() - Math.max(0, Math.trunc(maxAgeMs))
	return ensureActiveDb().prepare(PRUNE_LOGS_SQL).run(cutoffMs)
}
