import { OpenAIResponsesLanguageModel } from "@ai-sdk/openai/internal"
import {
	APICallError,
	type LanguageModelV3,
	type LanguageModelV3Content,
	type LanguageModelV3FinishReason,
	type LanguageModelV3ResponseMetadata,
	type LanguageModelV3Usage,
	NoSuchModelError,
	type ProviderV3,
	type SharedV3ProviderMetadata,
	type SharedV3Warning,
} from "@ai-sdk/provider"
import { type FetchFunction, withUserAgentSuffix } from "@ai-sdk/provider-utils"
import {
	type CodexOAuthSettings,
	createCodexOAuthFetch,
	DEFAULT_CODEX_BASE_URL,
} from "../../openai-oauth-core/src/index.js"

export type OpenAIOAuthModelId = string

export type OpenAIOAuthProviderSettings = CodexOAuthSettings & {
	name?: string
}

type OpenAIConfig = {
	provider: string
	url: (options: { modelId: string; path: string }) => string
	headers: () => Record<string, string | undefined>
	fetch?: FetchFunction
	generateId?: () => string
	fileIdPrefixes?: readonly string[]
}

const emptyUsage = (): LanguageModelV3Usage => ({
	inputTokens: {
		total: undefined,
		noCache: undefined,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: undefined, text: undefined, reasoning: undefined },
})

const mergeProviderMetadata = (
	left: SharedV3ProviderMetadata | undefined,
	right: SharedV3ProviderMetadata | undefined,
): SharedV3ProviderMetadata | undefined => {
	if (left == null) return right
	if (right == null) return left

	const merged: SharedV3ProviderMetadata = { ...left }
	for (const [provider, value] of Object.entries(right)) {
		const existing = merged[provider]
		merged[provider] = existing == null ? value : { ...existing, ...value }
	}

	return merged
}

class CodexResponsesLanguageModel extends OpenAIResponsesLanguageModel {
	async doGenerate(
		options: Parameters<LanguageModelV3["doGenerate"]>[0],
	): Promise<Awaited<ReturnType<LanguageModelV3["doGenerate"]>>> {
		const streamResult = await super.doStream(options)
		const reader = streamResult.stream.getReader()

		const content: Array<LanguageModelV3Content> = []
		const warnings: Array<SharedV3Warning> = []
		const activeTextById = new Map<string, LanguageModelV3Content>()
		const activeReasoningById = new Map<string, LanguageModelV3Content>()

		let finishReason: LanguageModelV3FinishReason = {
			unified: "other",
			raw: "unknown",
		}
		let usage: LanguageModelV3Usage = emptyUsage()
		let providerMetadata: SharedV3ProviderMetadata | undefined
		let responseMetadata: LanguageModelV3ResponseMetadata | undefined

		try {
			while (true) {
				const { value: part, done } = await reader.read()
				if (done) {
					break
				}

				switch (part.type) {
					case "stream-start": {
						warnings.push(...part.warnings)
						break
					}

					case "response-metadata": {
						responseMetadata = {
							id: part.id,
							timestamp: part.timestamp,
							modelId: part.modelId,
						}
						break
					}

					case "text-start": {
						const textPart: LanguageModelV3Content = {
							type: "text",
							text: "",
							providerMetadata: part.providerMetadata,
						}

						content.push(textPart)
						activeTextById.set(part.id, textPart)
						break
					}

					case "text-delta": {
						const existing = activeTextById.get(part.id)
						if (existing == null) {
							const textPart: LanguageModelV3Content = {
								type: "text",
								text: part.delta,
								providerMetadata: part.providerMetadata,
							}

							content.push(textPart)
							activeTextById.set(part.id, textPart)
						} else if (existing.type === "text") {
							existing.text += part.delta
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
						}
						break
					}

					case "text-end": {
						const existing = activeTextById.get(part.id)
						if (existing?.type === "text") {
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
							activeTextById.delete(part.id)
						}
						break
					}

					case "reasoning-start": {
						const reasoningPart: LanguageModelV3Content = {
							type: "reasoning",
							text: "",
							providerMetadata: part.providerMetadata,
						}

						content.push(reasoningPart)
						activeReasoningById.set(part.id, reasoningPart)
						break
					}

					case "reasoning-delta": {
						const existing = activeReasoningById.get(part.id)
						if (existing == null) {
							const reasoningPart: LanguageModelV3Content = {
								type: "reasoning",
								text: part.delta,
								providerMetadata: part.providerMetadata,
							}

							content.push(reasoningPart)
							activeReasoningById.set(part.id, reasoningPart)
						} else if (existing.type === "reasoning") {
							existing.text += part.delta
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
						}
						break
					}

					case "reasoning-end": {
						const existing = activeReasoningById.get(part.id)
						if (existing?.type === "reasoning") {
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
							activeReasoningById.delete(part.id)
						}
						break
					}

					case "tool-input-start":
					case "tool-input-delta":
					case "tool-input-end":
					case "tool-approval-request": {
						break
					}

					case "tool-call":
					case "tool-result":
					case "file":
					case "source": {
						content.push(part)
						break
					}

					case "finish": {
						finishReason = part.finishReason
						usage = part.usage
						providerMetadata = part.providerMetadata
						break
					}

					case "raw": {
						break
					}

					case "error": {
						throw part.error instanceof Error
							? part.error
							: new Error("Streaming request failed.", { cause: part.error })
					}

					default: {
						part satisfies never
					}
				}
			}
		} finally {
			reader.releaseLock()
		}

		const responseHeaders = streamResult.response?.headers
		const response =
			responseMetadata == null && responseHeaders == null
				? undefined
				: {
						...(responseMetadata ?? {}),
						...(responseHeaders == null ? {} : { headers: responseHeaders }),
					}

		return {
			content,
			finishReason,
			usage,
			providerMetadata,
			request: streamResult.request,
			response,
			warnings,
		}
	}
}

export interface OpenAIOAuthProvider extends ProviderV3 {
	(modelId: OpenAIOAuthModelId): LanguageModelV3
	languageModel(modelId: OpenAIOAuthModelId): LanguageModelV3
}

const isQuotaResponseBody = (
	body: string,
): { match: boolean; message?: string } => {
	if (body.length === 0) {
		return { match: false }
	}

	try {
		const parsed = JSON.parse(body) as unknown
		if (parsed != null && typeof parsed === "object") {
			const error = (parsed as { error?: unknown }).error
			if (error != null && typeof error === "object") {
				const type = (error as { type?: unknown }).type
				const message = (error as { message?: unknown }).message
				if (
					typeof type === "string" &&
					(type === "usage_limit_reached" || type === "credit_limit_reached")
				) {
					return {
						match: true,
						message:
							typeof message === "string" && message.length > 0
								? message
								: "ChatGPT account usage limit reached.",
					}
				}
			}
		}
	} catch {
		// fall through to substring check
	}

	if (
		body.includes("usage_limit_reached") ||
		body.includes("credit_limit_reached")
	) {
		return {
			match: true,
			message: "ChatGPT account usage limit reached.",
		}
	}

	return { match: false }
}

const wrapWithUsageLimitGuard = (innerFetch: FetchFunction): FetchFunction => {
	const guarded: FetchFunction = async (input, init) => {
		const response = await innerFetch(input, init)
		if (response.status !== 429 && response.status !== 402) {
			return response
		}

		// Read once, return a fresh Response if it turns out the body
		// is not a usage-limit error (so the SDK can still process it).
		const body = await response.text().catch(() => "")
		const detection = isQuotaResponseBody(body)
		const responseHeaders: Record<string, string> = {}
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value
		})

		if (!detection.match) {
			return new Response(body, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			})
		}

		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input instanceof Request
						? input.url
						: String(input)

		throw new APICallError({
			message: detection.message ?? "ChatGPT account usage limit reached.",
			url,
			requestBodyValues: undefined,
			statusCode: response.status,
			responseHeaders,
			responseBody: body,
			isRetryable: false,
			data: { upstream_error_type: "usage_limit_reached" },
		})
	}

	const inner = innerFetch as FetchFunction & {
		preconnect?: (...args: unknown[]) => unknown
	}
	if (typeof inner.preconnect === "function") {
		;(
			guarded as FetchFunction & {
				preconnect?: (...args: unknown[]) => unknown
			}
		).preconnect = inner.preconnect.bind(innerFetch)
	}

	return guarded
}

export const createOpenAIOAuth = (
	settings: OpenAIOAuthProviderSettings = {},
): OpenAIOAuthProvider => {
	const baseURL = settings.baseURL ?? DEFAULT_CODEX_BASE_URL
	const providerName = settings.name ?? "openai"
	const oauthFetch = createCodexOAuthFetch(settings)
	const guardedFetch = wrapWithUsageLimitGuard(oauthFetch)

	const config: OpenAIConfig = {
		provider: `${providerName}.responses`,
		url: ({ path }) => `${baseURL}${path}`,
		headers: () => withUserAgentSuffix({}, "oai-oauth/0.0.0"),
		fetch: guardedFetch,
		fileIdPrefixes: ["file-"],
	}

	const createModel = (modelId: OpenAIOAuthModelId) =>
		new CodexResponsesLanguageModel(modelId, config)

	const providerFn = (modelId: OpenAIOAuthModelId) => createModel(modelId)
	const specificationVersion: ProviderV3["specificationVersion"] = "v3"

	return Object.assign(providerFn, {
		specificationVersion,
		languageModel: createModel,
		embeddingModel: (modelId: string) => {
			throw new NoSuchModelError({ modelId, modelType: "embeddingModel" })
		},
		imageModel: (modelId: string) => {
			throw new NoSuchModelError({ modelId, modelType: "imageModel" })
		},
	})
}

export const openai = createOpenAIOAuth()
