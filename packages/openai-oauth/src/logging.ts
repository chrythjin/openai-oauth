import {
	insertRequestLog,
	openUsageDatabase,
	pruneOldRequestLogs,
	REQUEST_LOG_RETENTION_MS,
} from "./db.js"
import type {
	OpenAIOAuthServerLogEvent,
	OpenAIOAuthServerOptions,
} from "./types.js"

const REQUEST_LOG_QUEUE_LIMIT = 1_000
const REQUEST_LOG_FLUSH_DELAY_MS = 25
const REQUEST_LOG_PRUNE_INTERVAL_MS = Math.min(
	5 * 60 * 1000,
	REQUEST_LOG_RETENTION_MS,
)

type TimerHandle = ReturnType<typeof setTimeout>

export type RequestLogger = ((event: OpenAIOAuthServerLogEvent) => void) & {
	close?: () => void
	flush?: () => void
}

const unrefTimer = (timer: TimerHandle): TimerHandle => {
	timer.unref?.()
	return timer
}

const createSQLiteRequestLogger = (): RequestLogger | undefined => {
	try {
		const db = openUsageDatabase()
		const queue: OpenAIOAuthServerLogEvent[] = []
		let flushTimer: TimerHandle | undefined
		let pruneTimer: TimerHandle | undefined
		let closed = false
		let droppedEvents = 0

		const flush = () => {
			flushTimer = undefined
			while (queue.length > 0) {
				const event = queue.shift()
				if (!event) {
					continue
				}

				try {
					insertRequestLog(db, event)
				} catch {
					// Suppress DB write errors so request logging never breaks the proxy.
				}
			}
		}

		const scheduleFlush = () => {
			if (flushTimer || closed) {
				return
			}

			flushTimer = unrefTimer(setTimeout(flush, REQUEST_LOG_FLUSH_DELAY_MS))
		}

		const prune = () => {
			try {
				pruneOldRequestLogs(db)
			} catch {
				// Suppress pruning errors; retention cleanup must not affect requests.
			}

			if (!closed) {
				pruneTimer = unrefTimer(
					setTimeout(prune, REQUEST_LOG_PRUNE_INTERVAL_MS),
				)
			}
		}

		pruneTimer = unrefTimer(setTimeout(prune, REQUEST_LOG_PRUNE_INTERVAL_MS))

		const logger: RequestLogger = (event) => {
			if (closed) {
				return
			}

			if (queue.length >= REQUEST_LOG_QUEUE_LIMIT) {
				queue.shift()
				droppedEvents += 1
				if (
					droppedEvents === 1 ||
					droppedEvents % REQUEST_LOG_QUEUE_LIMIT === 0
				) {
					console.warn(
						`Request log queue overflowed; dropped ${droppedEvents} oldest event(s).`,
					)
				}
			}

			queue.push(event)
			scheduleFlush()
		}

		logger.flush = flush
		logger.close = () => {
			closed = true
			if (flushTimer) {
				clearTimeout(flushTimer)
				flushTimer = undefined
			}
			if (pruneTimer) {
				clearTimeout(pruneTimer)
				pruneTimer = undefined
			}
			flush()
			db.close()
		}

		return logger
	} catch {
		// Suppress DB initialization errors.
		return undefined
	}
}

export const createRequestLogger = (
	settings: OpenAIOAuthServerOptions,
): RequestLogger | undefined => {
	const loggers: RequestLogger[] = []

	// 1. User-provided logger
	if (typeof settings.requestLogger === "function") {
		loggers.push(settings.requestLogger as RequestLogger)
	}

	// 2. Console logger (env-gated)
	if (process.env.CODEX_OPENAI_SERVER_LOG_REQUESTS === "1") {
		loggers.push(((event) => {
			console.log(
				JSON.stringify({
					source: "openai-oauth",
					timestamp: new Date().toISOString(),
					...event,
				}),
			)
		}) as RequestLogger)
	}

	// 3. SQLite persistence logger
	const sqliteLogger = createSQLiteRequestLogger()
	if (sqliteLogger) {
		loggers.push(sqliteLogger)
	}

	if (loggers.length === 0) {
		return undefined
	}

	const logger: RequestLogger = (event) => {
		for (const childLogger of loggers) {
			try {
				childLogger(event)
			} catch {
				// Individual logger failures should not break the proxy.
			}
		}
	}

	logger.flush = () => {
		for (const childLogger of loggers) {
			try {
				childLogger.flush?.()
			} catch {}
		}
	}

	logger.close = () => {
		for (const childLogger of loggers) {
			try {
				childLogger.close?.()
			} catch {}
		}
	}

	return logger
}

export const emitRequestLog = (
	logger: RequestLogger | undefined,
	event: OpenAIOAuthServerLogEvent,
) => {
	try {
		logger?.(event)
	} catch {}
}
