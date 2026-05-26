import { APICallError } from "@ai-sdk/provider"
import { streamText } from "ai"
import type { OpenAIOAuthProvider } from "../../openai-oauth-provider/src/index.js"
import {
	createToolSet,
	toModelMessages,
	toToolChoice,
} from "./chat-messages.js"
import { emitRequestLog } from "./logging.js"
import { resolveOpenAIOAuthModelAlias } from "./models.js"
import {
	corsHeaders,
	mapFinishReason,
	sseHeaders,
	toErrorResponse,
	toUsage,
} from "./shared.js"
import type {
	ChatRequest,
	OpenAIOAuthServerLogEvent,
	UsageLike,
} from "./types.js"

const encodeSse = (data: unknown): Uint8Array =>
	new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)

const encodeDone = (): Uint8Array =>
	new TextEncoder().encode("data: [DONE]\n\n")

type ClientFacingError = {
	status: number
	type: string
	message: string
}

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

const classifyStreamError = (error: unknown): ClientFacingError => {
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
			error instanceof Error
				? error.message
				: "Streaming chat completion failed.",
	}
}

const logChatStreamResult = (
	logger: ((event: OpenAIOAuthServerLogEvent) => void) | undefined,
	requestId: string,
	startedAt: number,
	finishReason: string,
	usage: UsageLike,
) => {
	emitRequestLog(logger, {
		type: "chat_response",
		requestId,
		path: "/v1/chat/completions",
		status: 200,
		stream: true,
		durationMs: Date.now() - startedAt,
		finishReason,
		usage,
	})
}

type StreamPart = {
	type: string
	[key: string]: unknown
}

export const streamChatCompletions = async (
	request: ChatRequest,
	provider: OpenAIOAuthProvider,
	logContext: {
		logger?: (event: OpenAIOAuthServerLogEvent) => void
		requestId: string
		startedAt: number
	},
): Promise<Response> => {
	const created = Math.floor(Date.now() / 1000)
	const id = `chatcmpl_${crypto.randomUUID()}`
	const resolvedModel = resolveOpenAIOAuthModelAlias(request.model ?? "gpt-5.2")
	const upstreamReasoningEffort =
		request.reasoning_effort ?? resolvedModel.reasoningEffort
	const result = streamText({
		model: provider(resolvedModel.model),
		messages: toModelMessages(request.messages ?? []),
		tools: createToolSet(request.tools),
		toolChoice: toToolChoice(request.tool_choice),
		temperature: request.temperature,
		topP: request.top_p,
		stopSequences:
			typeof request.stop === "string"
				? [request.stop]
				: Array.isArray(request.stop)
					? request.stop
					: undefined,
		maxOutputTokens: request.max_tokens,
		providerOptions: {
			openai: {
				parallelToolCalls: request.parallel_tool_calls,
				reasoningEffort: upstreamReasoningEffort,
			},
		},
	})

	// Peek the first part of fullStream so we can fail fast with an HTTP error
	// response if the upstream rejects the request before producing any data.
	const iterator = result.fullStream[
		Symbol.asyncIterator
	]() as AsyncIterator<StreamPart>
	let firstResult: IteratorResult<StreamPart> | undefined
	try {
		firstResult = await iterator.next()
	} catch (error) {
		const classified = classifyStreamError(error)
		emitRequestLog(logContext.logger, {
			type: "chat_error",
			requestId: logContext.requestId,
			path: "/v1/chat/completions",
			durationMs: Date.now() - logContext.startedAt,
			message: classified.message,
		})
		return toErrorResponse(
			classified.message,
			classified.status,
			classified.type,
		)
	}

	const firstPart = firstResult?.value as StreamPart | undefined

	if (
		firstResult?.done !== true &&
		firstPart != null &&
		firstPart.type === "error"
	) {
		const classified = classifyStreamError(firstPart.error)
		emitRequestLog(logContext.logger, {
			type: "chat_error",
			requestId: logContext.requestId,
			path: "/v1/chat/completions",
			durationMs: Date.now() - logContext.startedAt,
			message: classified.message,
		})
		return toErrorResponse(
			classified.message,
			classified.status,
			classified.type,
		)
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const toolIndexes = new Map<string, number>()
			const toolsWithDeltas = new Set<string>()
			let closed = false

			const closeWithError = (error: unknown) => {
				if (closed) {
					return
				}
				const classified = classifyStreamError(error)
				emitRequestLog(logContext.logger, {
					type: "chat_error",
					requestId: logContext.requestId,
					path: "/v1/chat/completions",
					durationMs: Date.now() - logContext.startedAt,
					message: classified.message,
				})
				controller.enqueue(
					encodeSse({
						error: {
							message: classified.message,
							type: classified.type,
							code: classified.status,
						},
					}),
				)
				controller.enqueue(encodeDone())
				controller.close()
				closed = true
			}

			const handlePart = (part: StreamPart): boolean => {
				switch (part.type) {
					case "text-delta":
						controller.enqueue(
							encodeSse({
								id,
								object: "chat.completion.chunk",
								created,
								model: request.model,
								choices: [
									{
										index: 0,
										delta: { content: part.text as string },
										finish_reason: null,
									},
								],
							}),
						)
						break
					case "tool-input-start": {
						const partId = part.id as string
						const nextIndex = toolIndexes.size
						toolIndexes.set(partId, nextIndex)
						controller.enqueue(
							encodeSse({
								id,
								object: "chat.completion.chunk",
								created,
								model: request.model,
								choices: [
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index: nextIndex,
													id: partId,
													type: "function",
													function: {
														name: part.toolName as string,
														arguments: "",
													},
												},
											],
										},
										finish_reason: null,
									},
								],
							}),
						)
						break
					}
					case "tool-input-delta": {
						const partId = part.id as string
						const index = toolIndexes.get(partId)
						if (index == null) {
							break
						}
						toolsWithDeltas.add(partId)
						controller.enqueue(
							encodeSse({
								id,
								object: "chat.completion.chunk",
								created,
								model: request.model,
								choices: [
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index,
													function: { arguments: part.delta as string },
												},
											],
										},
										finish_reason: null,
									},
								],
							}),
						)
						break
					}
					case "tool-call": {
						// Some models (e.g. gpt-5.3-codex-spark) return tool call
						// arguments in one shot without streaming deltas. When no
						// tool-input-delta events were emitted, emit the complete
						// arguments from the final tool-call event.
						const toolCallId = part.toolCallId as string
						const index = toolIndexes.get(toolCallId)
						if (index == null || toolsWithDeltas.has(toolCallId)) {
							break
						}
						controller.enqueue(
							encodeSse({
								id,
								object: "chat.completion.chunk",
								created,
								model: request.model,
								choices: [
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index,
													function: {
														arguments: JSON.stringify(part.input),
													},
												},
											],
										},
										finish_reason: null,
									},
								],
							}),
						)
						break
					}
					case "finish":
						logChatStreamResult(
							logContext.logger,
							logContext.requestId,
							logContext.startedAt,
							part.finishReason as string,
							part.totalUsage as UsageLike,
						)
						controller.enqueue(
							encodeSse({
								id,
								object: "chat.completion.chunk",
								created,
								model: request.model,
								choices: [
									{
										index: 0,
										delta: {},
										finish_reason: mapFinishReason(part.finishReason as string),
									},
								],
							}),
						)
						controller.enqueue(
							encodeSse({
								id,
								object: "chat.completion.chunk",
								created,
								model: request.model,
								choices: [],
								usage: toUsage(part.totalUsage as UsageLike),
							}),
						)
						break
					case "error":
						closeWithError(part.error)
						return false
				}
				return true
			}

			// Emit initial role chunk only once we know upstream is healthy.
			controller.enqueue(
				encodeSse({
					id,
					object: "chat.completion.chunk",
					created,
					model: request.model,
					choices: [
						{ index: 0, delta: { role: "assistant" }, finish_reason: null },
					],
				}),
			)

			try {
				if (firstResult?.done !== true && firstPart != null) {
					if (!handlePart(firstPart)) {
						return
					}
				}

				while (true) {
					const next = await iterator.next()
					if (next.done) {
						break
					}
					if (!handlePart(next.value)) {
						return
					}
				}
			} catch (error) {
				closeWithError(error)
				return
			}

			if (!closed) {
				controller.enqueue(encodeDone())
				controller.close()
				closed = true
			}
		},
	})

	return new Response(stream, {
		status: 200,
		headers: {
			...sseHeaders,
			...corsHeaders,
		},
	})
}
