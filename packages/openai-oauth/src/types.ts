import type { Server as HttpServer } from "node:http"
import type { CodexOAuthSettings } from "../../openai-oauth-core/src/index.js"

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| JsonObject
export type JsonObject = { [key: string]: JsonValue }

export type ToolOutputValue =
	| {
			type: "json"
			value: JsonValue
	  }
	| {
			type: "text"
			value: string
	  }

export type ChatToolDefinition = {
	type?: string
	function?: {
		name?: string
		description?: string
		parameters?: JsonObject
	}
}

export type ChatToolChoice =
	| "auto"
	| "none"
	| "required"
	| {
			type?: string
			function?: {
				name?: string
			}
	  }

export type ChatMessage = {
	role?: string
	content?: unknown
	refusal?: string
	tool_calls?: Array<{
		id?: string
		type?: string
		function?: {
			name?: string
			arguments?: string
		}
	}>
	tool_call_id?: string
}

export type ChatRequest = {
	model?: string
	messages?: ChatMessage[]
	stream?: boolean
	tools?: ChatToolDefinition[]
	tool_choice?: ChatToolChoice
	temperature?: number
	top_p?: number
	stop?: string | string[]
	max_tokens?: number
	parallel_tool_calls?: boolean
	reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
}

export type ChatRequestSummary = {
	bodyKeys: string[]
	messageCount: number
	messageRoles: string[]
	model?: string
	reasoningEffort?: ChatRequest["reasoning_effort"]
	stream: boolean
	toolCount: number
}

type UsageLike = {
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
	reasoningTokens?: number
	cachedInputTokens?: number
}

export type OpenAIOAuthServerLogEvent =
	| ({
			type: "chat_request"
			requestId: string
			path: string
	  } & ChatRequestSummary)
	| {
			type: "chat_response"
			durationMs: number
			finishReason?: string
			path: string
			requestId: string
			status: number
			stream: boolean
			usage: UsageLike
	  }
	| {
			type: "chat_error"
			durationMs: number
			message: string
			path: string
			requestId: string
	  }

export const defaultOpenAIOAuthModels: readonly string[] = [
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.3-codex",
	"gpt-5.2",
	"codex-auto-review",
]

export type OpenAIOAuthServerOptions = Omit<
	CodexOAuthSettings,
	"responsesState"
> & {
	host?: string
	port?: number
	models?: string[]
	codexVersion?: string
	requestLogger?: (event: OpenAIOAuthServerLogEvent) => void
	/** Absolute path to the dashboard dist directory. If set, /dashboard/* routes serve static files. */
	dashboardDistPath?: string
}

export type RunningOpenAIOAuthServer = {
	server: HttpServer
	host: string
	port: number
	url: string
	close: () => Promise<void>
}

export type ChatCompletionResultShape = {
	text: string
	finishReason: string
	toolCalls: Array<{
		toolCallId: string
		toolName: string
		input: unknown
	}>
	usage: UsageLike
}

export type { UsageLike }
