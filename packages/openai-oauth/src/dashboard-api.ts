import { getExpectedOrigins } from "./dashboard-security.js"
import {
	getHourlyUsage,
	getRecentLogs,
	getUsageSummary,
	openUsageDatabase,
} from "./db.js"
import { toDashboardErrorResponse, toDashboardJsonResponse } from "./shared.js"
import type {
	OpenAIOAuthServerLogEvent,
	OpenAIOAuthServerOptions,
} from "./types.js"
import {
	getActiveTokenInfo,
	isProxyHealthy,
	resolveVaultPaths,
} from "./vault-ops.js"

function stripTrailingSlash(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith("/")) {
		return pathname.slice(0, -1)
	}
	return pathname
}

function formatUptime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "—"
	const s = Math.floor(seconds % 60)
	const m = Math.floor((seconds / 60) % 60)
	const h = Math.floor((seconds / 3600) % 24)
	const d = Math.floor(seconds / 86400)
	if (d > 0) return `${d}d ${h}h ${m}m`
	if (h > 0) return `${h}h ${m}m ${s}s`
	if (m > 0) return `${m}m ${s}s`
	return `${s}s`
}

export const handleDashboardApiRequest = async (
	request: Request,
	_logger: (event: OpenAIOAuthServerLogEvent) => void,
	settings: OpenAIOAuthServerOptions,
): Promise<Response> => {
	const url = new URL(request.url)
	const path = stripTrailingSlash(url.pathname)

	// Handle preflight for dashboard routes
	if (request.method === "OPTIONS") {
		const origin = request.headers.get("origin")
		const expectedOrigins = getExpectedOrigins(request)
		const allowOrigin =
			origin && expectedOrigins.includes(origin) ? origin : expectedOrigins[0]
		return new Response(null, {
			status: 204,
			headers: {
				"access-control-allow-origin": allowOrigin,
				"access-control-allow-methods": "GET,OPTIONS",
				"access-control-allow-headers": "authorization,content-type",
			},
		})
	}

	let db: ReturnType<typeof openUsageDatabase> | undefined
	try {
		db = openUsageDatabase()
	} catch {
		// If DB fails to open, we'll return stubs or errors
	}

	try {
		if (request.method === "GET" && path === "/api/dashboard/summary") {
			const summary = db ? getUsageSummary(db) : null
			return toDashboardJsonResponse({
				totalRequests: summary?.requestCount ?? 0,
				totalTokens: summary?.totalTokens ?? 0,
				errorCount: summary?.errorCount ?? 0,
				uptime: formatUptime(process.uptime()),
			})
		}

		if (request.method === "GET" && path === "/api/dashboard/logs") {
			const logs = db ? getRecentLogs(db, 50) : []
			return toDashboardJsonResponse(
				logs.map((log) => ({
					id: log.id,
					timestamp: log.timestamp,
					type: log.type,
					path: log.path,
					model: log.model ?? undefined,
					status: log.status ?? undefined,
					durationMs: log.durationMs,
					message: log.errorMessage ?? undefined,
					usage: {
						inputTokens: log.inputTokens,
						outputTokens: log.outputTokens,
						totalTokens: log.totalTokens,
					},
				})),
			)
		}

		if (request.method === "GET" && path === "/api/dashboard/status") {
			const vaultPaths = resolveVaultPaths(settings.authFilePath)
			const activeToken = getActiveTokenInfo(vaultPaths)

			return toDashboardJsonResponse({
				healthy: await isProxyHealthy(settings.port),
				uptime: process.uptime(),
				active_token: activeToken
					? {
							slot: activeToken.slot,
							label: activeToken.label,
							active: activeToken.active,
							inVault: activeToken.inVault,
							expiry: activeToken.expiry,
						}
					: null,
			})
		}

		if (request.method === "GET" && path === "/api/dashboard/hourly") {
			const hourly = db ? getHourlyUsage(db) : []
			// Ensure we have 24 buckets? db.ts already does some work,
			// but we might need to pad it if the frontend expects exactly 24.
			// For now, let's just return what we have as per plan.
			return toDashboardJsonResponse(
				hourly.map((h) => ({
					hour: h.hour,
					requests: h.requestCount,
					tokens: h.totalTokens,
				})),
			)
		}

		return toDashboardErrorResponse("Route not found.", 404, "not_found_error")
	} finally {
		if (db) {
			try {
				db.close()
			} catch {}
		}
	}
}
