import { APICallError } from "@ai-sdk/provider"
import { generateText } from "ai"
import type { OpenAIOAuthProvider } from "../../openai-oauth-provider/src/index.js"
import {
	createToolSet,
	toModelMessages,
	toToolChoice,
} from "./chat-messages.js"
import { streamChatCompletions } from "./chat-stream.js"
import { emitRequestLog } from "./logging.js"
import { resolveOpenAIOAuthModelAlias } from "./models.js"
import {
	isRecord,
	mapFinishReason,
	summarizeChatRequest,
	toErrorResponse,
	toJsonResponse,
	toUsage,
} from "./shared.js"
import type {
	ChatCompletionResultShape,
	ChatRequest,
	OpenAIOAuthServerLogEvent,
} from "./types.js"

const isChatRequest = (value: unknown): value is ChatRequest =>
	isRecord(value) &&
	(value.messages === undefined || Array.isArray(value.messages))

const RETRY_FAILURE_PREFIX = "Failed after"

const extractApiCallError = (error: unknown): APICallError | undefined => {
	if (APICallError.isInstance(error)) {
		return error
	}
	if (error instanceof Error && error.cause != null) {
		return extractApiCallError(error.cause)
	}
	return undefined
}

const classifyGenerateError = (
	error: unknown,
): { status: number; type: string; message: string } => {
	const apiError = extractApiCallError(error)
	if (apiError != null) {
		const status = apiError.statusCode ?? 502
		let type = "upstream_error"
		let message = apiError.message

		if (
			apiError.data != null &&
			typeof apiError.data === "object" &&
			(apiError.data as { upstream_error_type?: unknown })
				.upstream_error_type === "usage_limit_reached"
		) {
			type = "usage_limit_reached"
			message =
				"ChatGPT account usage limit reached. Switch to another token slot or wait for the upstream limit to reset."
		} else if (status === 429) {
			type = "rate_limit_exceeded"
		} else if (status === 401 || status === 403) {
			type = "authentication_error"
		} else if (status >= 500) {
			type = "upstream_error"
		} else if (status >= 400) {
			type = "invalid_request_error"
		}

		return { status, type, message }
	}

	if (
		error instanceof Error &&
		error.message.startsWith(RETRY_FAILURE_PREFIX)
	) {
		return {
			status: 502,
			type: "upstream_error",
			message: `Upstream call failed after retries: ${error.message}`,
		}
	}

	return {
		status: 500,
		type: "server_error",
		message:
			error instanceof Error ? error.message : "Unexpected server error.",
	}
}

const toChatCompletionResponse = (
	result: ChatCompletionResultShape,
	request: ChatRequest,
): Response => {
	const toolCalls = result.toolCalls.map((toolCall) => ({
		id: toolCall.toolCallId,
		type: "function",
		function: {
			name: toolCall.toolName,
			arguments: JSON.stringify(toolCall.input),
		},
	}))

	return toJsonResponse({
		id: `chatcmpl_${crypto.randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: request.model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: result.text.length > 0 ? result.text : null,
					tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
				},
				finish_reason: mapFinishReason(result.finishReason),
			},
		],
		usage: toUsage(result.usage),
	})
}

export const handleChatCompletionsRequest = async (
	request: Request,
	provider: OpenAIOAuthProvider,
	logger: ((event: OpenAIOAuthServerLogEvent) => void) | undefined,
): Promise<Response> => {
	const requestId = crypto.randomUUID()
	const startedAt = Date.now()
	const body = await request.json()

	if (!isChatRequest(body) || !Array.isArray(body.messages)) {
		emitRequestLog(logger, {
			type: "chat_error",
			requestId,
			path: "/v1/chat/completions",
			durationMs: Date.now() - startedAt,
			message: "`messages` must be an array.",
		})
		return toErrorResponse("`messages` must be an array.")
	}

	const resolvedModel = resolveOpenAIOAuthModelAlias(body.model ?? "gpt-5.2")
	const upstreamReasoningEffort =
		body.reasoning_effort ?? resolvedModel.reasoningEffort

	emitRequestLog(logger, {
		type: "chat_request",
		requestId,
		path: "/v1/chat/completions",
		...summarizeChatRequest(body),
	})

	if (body.stream === true) {
		return streamChatCompletions(body, provider, {
			logger,
			requestId,
			startedAt,
		})
	}

	try {
		const result = await generateText({
			model: provider(resolvedModel.model),
			messages: toModelMessages(body.messages),
			tools: createToolSet(body.tools),
			toolChoice: toToolChoice(body.tool_choice),
			temperature: body.temperature,
			topP: body.top_p,
			stopSequences:
				typeof body.stop === "string"
					? [body.stop]
					: Array.isArray(body.stop)
						? body.stop
						: undefined,
			maxOutputTokens: body.max_tokens,
			providerOptions: {
				openai: {
					parallelToolCalls: body.parallel_tool_calls,
					reasoningEffort: upstreamReasoningEffort,
				},
			},
		})

		emitRequestLog(logger, {
			type: "chat_response",
			requestId,
			path: "/v1/chat/completions",
			status: 200,
			stream: false,
			durationMs: Date.now() - startedAt,
			finishReason: result.finishReason,
			usage: result.usage,
		})

		return toChatCompletionResponse(result, body)
	} catch (error) {
		const classified = classifyGenerateError(error)
		emitRequestLog(logger, {
			type: "chat_error",
			requestId,
			path: "/v1/chat/completions",
			durationMs: Date.now() - startedAt,
			message: classified.message,
		})
		return toErrorResponse(
			classified.message,
			classified.status,
			classified.type,
		)
	}
}
