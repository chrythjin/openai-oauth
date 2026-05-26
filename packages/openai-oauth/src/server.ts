import { existsSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import {
	type CodexOAuthSettings,
	createCodexOAuthClient,
} from "../../openai-oauth-core/src/index.js"
import {
	createOpenAIOAuth,
	type OpenAIOAuthProvider,
} from "../../openai-oauth-provider/src/index.js"
import { handleChatCompletionsRequest } from "./chat-completions.js"
import { handleDashboardApiRequest } from "./dashboard-api.js"
import { getExpectedOrigins, getSecurityHeaders } from "./dashboard-security.js"
import { handleDashboardStaticRequest } from "./dashboard-static.js"
import { createRequestLogger } from "./logging.js"
import { createModelResolver } from "./models.js"
import { handleResponsesRequest } from "./responses.js"
import {
	corsHeaders,
	DEFAULT_HOST,
	DEFAULT_PORT,
	resolveAddress,
	toErrorResponse,
	toJsonResponse,
	toWebRequest,
	writeWebResponse,
} from "./shared.js"
import { handleTokenApiRequest } from "./token-vault-api.js"
import type {
	OpenAIOAuthServerOptions,
	RunningOpenAIOAuthServer,
} from "./types.js"
import { resolveVaultPaths } from "./vault-ops.js"

const handleRoutes = async (
	request: Request,
	settings: OpenAIOAuthServerOptions,
	provider: OpenAIOAuthProvider,
	client: ReturnType<typeof createCodexOAuthClient>,
	resolveModels: () => Promise<string[]>,
	requestLogger: ReturnType<typeof createRequestLogger>,
): Promise<Response> => {
	const url = new URL(request.url)
	const { pathname } = url

	if (request.method === "OPTIONS") {
		if (pathname.startsWith("/api/dashboard/")) {
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
		return new Response(null, {
			status: 204,
			headers: corsHeaders,
		})
	}

	// ── Dashboard static files ─────────────────────────────────────
	if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
		const dist =
			settings.dashboardDistPath ??
			resolve(import.meta.dirname ?? ".", "dashboard")
		if (existsSync(resolve(dist, "index.html"))) {
			return handleDashboardStaticRequest(request, dist)
		}
	}

	// ── Dashboard API ───────────────────────────────────────────────
	if (pathname.startsWith("/api/dashboard/")) {
		const securityHeaders = getSecurityHeaders()
		const response = await handleDashboardApiRequest(
			request,
			requestLogger ?? (() => {}),
			settings,
		)
		for (const [k, v] of Object.entries(securityHeaders)) {
			response.headers.set(k, v)
		}
		return response
	}

	// ── Token management API ────────────────────────────────────────
	if (pathname.startsWith("/api/tokens/")) {
		const securityHeaders = getSecurityHeaders()
		const vaultPaths = resolveVaultPaths(settings.authFilePath)
		const response = await handleTokenApiRequest(request, vaultPaths)
		for (const [k, v] of Object.entries(securityHeaders)) {
			response.headers.set(k, v)
		}
		return response
	}

	if (request.method === "GET" && pathname === "/health") {
		return toJsonResponse({
			ok: true,
			replay_state: "stateless",
		})
	}

	if (request.method === "GET" && pathname === "/v1/models") {
		try {
			const models = await resolveModels()
			return toJsonResponse({
				object: "list",
				data: models.map((id) => ({
					id,
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				})),
			})
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Failed to load models.",
				502,
				"upstream_error",
			)
		}
	}

	if (request.method === "POST" && pathname === "/v1/responses") {
		return handleResponsesRequest(
			request,
			settings,
			client,
			requestLogger ?? undefined,
		)
	}

	if (request.method === "POST" && pathname === "/v1/chat/completions") {
		return handleChatCompletionsRequest(request, provider, requestLogger)
	}

	return toErrorResponse("Route not found.", 404, "not_found_error")
}

export const createOpenAIOAuthFetchHandler = (
	settings: OpenAIOAuthServerOptions = {},
): ((request: Request) => Promise<Response>) & {
	requestLogger?: ReturnType<typeof createRequestLogger>
} => {
	const sharedSettings: CodexOAuthSettings = {
		...settings,
		responsesState: false,
	}
	const client = createCodexOAuthClient(sharedSettings)
	const provider = createOpenAIOAuth(sharedSettings)
	const resolveModels = createModelResolver(client, settings.models, {
		codexVersion: settings.codexVersion,
	})
	const requestLogger = createRequestLogger(settings)

	const handler = (async (request) => {
		try {
			return await handleRoutes(
				request,
				settings,
				provider,
				client,
				resolveModels,
				requestLogger,
			)
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Unexpected server error.",
				500,
				"server_error",
			)
		}
	}) as ((request: Request) => Promise<Response>) & {
		requestLogger?: typeof requestLogger
	}

	handler.requestLogger = requestLogger
	return handler
}

export const startOpenAIOAuthServer = async (
	settings: OpenAIOAuthServerOptions = {},
): Promise<RunningOpenAIOAuthServer> => {
	const host = settings.host ?? DEFAULT_HOST
	const port = settings.port ?? DEFAULT_PORT
	const handler = createOpenAIOAuthFetchHandler(settings)
	const server = createServer(async (req, res) => {
		try {
			const request = await toWebRequest(req, { host, port })
			const response = await handler(request)
			await writeWebResponse(res, response)
		} catch (error) {
			if (res.headersSent || res.writableEnded) {
				res.destroy(error instanceof Error ? error : undefined)
				return
			}

			const message =
				error instanceof Error ? error.message : "Unexpected server error."
			await writeWebResponse(res, toErrorResponse(message, 500, "server_error"))
		}
	})

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(port, host, () => {
			server.off("error", reject)
			resolve()
		})
	})

	const address = resolveAddress(server.address() as AddressInfo, host)
	return {
		server,
		host: address.host,
		port: address.port,
		url: `http://${address.host}:${address.port}/v1`,
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error)
						return
					}

					resolve()
				})
			})
			handler.requestLogger?.close?.()
		},
	}
}
