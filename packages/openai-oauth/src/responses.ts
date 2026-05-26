import {
	type CodexOAuthClient,
	collectCompletedResponseFromSse,
	normalizeCodexResponsesBody,
} from "../../openai-oauth-core/src/index.js"
import { emitRequestLog } from "./logging.js"
import { resolveOpenAIOAuthModelAlias } from "./models.js"
import {
	corsHeaders,
	isRecord,
	sseHeaders,
	toErrorResponse,
	toJsonResponse,
	usesServerReplayState,
} from "./shared.js"
import type {
	OpenAIOAuthServerLogEvent,
	OpenAIOAuthServerOptions,
} from "./types.js"

const resolveResponsesBodyModelAlias = (
	body: Record<string, unknown>,
): Record<string, unknown> => {
	if (typeof body.model !== "string") {
		return body
	}

	const resolvedModel = resolveOpenAIOAuthModelAlias(body.model)
	if (resolvedModel.reasoningEffort == null) {
		return body
	}

	return {
		...body,
		model: resolvedModel.model,
		reasoning: {
			...(isRecord(body.reasoning) ? body.reasoning : {}),
			effort: resolvedModel.reasoningEffort,
		},
	}
}

export const handleResponsesRequest = async (
	request: Request,
	settings: OpenAIOAuthServerOptions,
	client: CodexOAuthClient,
	logger?: (event: OpenAIOAuthServerLogEvent) => void,
): Promise<Response> => {
	const startedAt = Date.now()
	const requestId = crypto.randomUUID()

	const body = await request.json().catch(() => null)
	if (!isRecord(body)) {
		emitRequestLog(logger, {
			type: "chat_error",
			requestId,
			path: "/v1/responses",
			durationMs: Date.now() - startedAt,
			message: "Request body must be a JSON object.",
		})
		return toErrorResponse("Request body must be a JSON object.")
	}

	// Emit chat_request log
	emitRequestLog(logger, {
		type: "chat_request",
		requestId,
		path: "/v1/responses",
		model: typeof body.model === "string" ? body.model : undefined,
		messageCount: Array.isArray(body.input) ? body.input.length : 0,
		messageRoles: [],
		stream: body.stream === true,
		reasoningEffort: undefined,
		toolCount: 0,
		bodyKeys: [],
	})

	if (usesServerReplayState(body)) {
		emitRequestLog(logger, {
			type: "chat_error",
			requestId,
			path: "/v1/responses",
			durationMs: Date.now() - startedAt,
			message:
				"Stateless responses endpoint does not support previous_response_id.",
		})
		return toErrorResponse(
			"Stateless Codex responses endpoint does not support `previous_response_id` or `item_reference`. Replay the full conversation history in `input` on each request.",
		)
	}

	const wantsStream = body.stream === true
	const upstream = await client.request("/responses", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(
			normalizeCodexResponsesBody(resolveResponsesBodyModelAlias(body), {
				forceStream: true,
				instructions: settings.instructions,
				store: settings.store,
			}),
		),
	})

	if (!upstream.ok) {
		const durationMs = Date.now() - startedAt
		emitRequestLog(logger, {
			type: "chat_error",
			requestId,
			path: "/v1/responses",
			durationMs,
			message: `Upstream error ${upstream.status}`,
		})
		const status = upstream.status
		const errorText = await upstream.text().catch(() => "")
		return new Response(errorText, {
			status,
			headers: {
				"content-type": "application/json; charset=utf-8",
				...Object.fromEntries(
					Object.entries(corsHeaders).map(([k, v]) => [k, v]),
				),
			},
		})
	}

	if (wantsStream) {
		emitRequestLog(logger, {
			type: "chat_response",
			requestId,
			path: "/v1/responses",
			status: upstream.status,
			stream: true,
			durationMs: Date.now() - startedAt,
			finishReason: undefined,
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		})
		return new Response(upstream.body, {
			status: upstream.status,
			headers: {
				...sseHeaders,
				...corsHeaders,
			},
		})
	}

	const completed = await collectCompletedResponseFromSse(
		upstream.body ?? new ReadableStream(),
	)
	emitRequestLog(logger, {
		type: "chat_response",
		requestId,
		path: "/v1/responses",
		status: 200,
		stream: false,
		durationMs: Date.now() - startedAt,
		finishReason: undefined,
		usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
	})
	return toJsonResponse(completed)
}
