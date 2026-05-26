export interface TokenSlot {
	slot: number
	label: string
	active: boolean
	inVault: boolean
	expiry: string | null
}

export interface SummaryData {
	totalRequests: number
	totalTokens: number
	errorCount: number
	uptime: string
}

export interface HourlyStat {
	hour: string
	requests: number
	tokens: number
}

export interface LogEntry {
	id: string
	timestamp: string
	type: "chat_request" | "chat_response" | "chat_error"
	path: string
	model?: string
	status?: number
	durationMs: number
	message?: string
	usage?: {
		inputTokens: number
		outputTokens: number
		totalTokens: number
	}
}
