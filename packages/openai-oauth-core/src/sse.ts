const SSE_SEPARATOR = /\r?\n\r?\n/

export type ServerSentEvent = {
	event?: string
	data?: string
}

const parseEventBlock = (block: string): ServerSentEvent => {
	const event: ServerSentEvent = {}
	const dataLines: string[] = []

	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			event.event = line.slice(6).trim()
			continue
		}

		if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trimStart())
		}
	}

	if (dataLines.length > 0) {
		event.data = dataLines.join("\n")
	}

	return event
}

export async function* iterateServerSentEvents(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	let buffer = ""

	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) {
				break
			}

			buffer += decoder.decode(value, { stream: true })
			const blocks = buffer.split(SSE_SEPARATOR)
			buffer = blocks.pop() ?? ""

			for (const block of blocks) {
				if (block.trim().length > 0) {
					yield parseEventBlock(block)
				}
			}
		}

		if (buffer.trim().length > 0) {
			yield parseEventBlock(buffer)
		}
	} finally {
		reader.releaseLock()
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const summarizeUpstreamError = (value: unknown): string => {
	// Only surface a small, known set of fields rather than JSON.stringify-ing
	// the entire upstream payload into an error message (which can then end up
	// in logs). Falls back to a generic label when nothing useful is present.
	const source = isRecord(value)
		? isRecord(value.error)
			? value.error
			: value
		: undefined

	if (source) {
		const type = typeof source.type === "string" ? source.type : undefined
		const code =
			typeof source.code === "string" || typeof source.code === "number"
				? String(source.code)
				: undefined
		const message =
			typeof source.message === "string" ? source.message : undefined
		const parts = [type ?? code, message].filter(
			(part): part is string => typeof part === "string" && part.length > 0,
		)
		if (parts.length > 0) {
			return parts.join(": ")
		}
	}

	return "upstream error"
}

export const collectCompletedResponseFromSse = async (
	stream: ReadableStream<Uint8Array>,
): Promise<Record<string, unknown>> => {
	let latestResponse: Record<string, unknown> | undefined
	let latestError: unknown

	for await (const event of iterateServerSentEvents(stream)) {
		if (typeof event.data !== "string" || event.data.length === 0) {
			continue
		}

		try {
			const parsed = JSON.parse(event.data)
			if (!isRecord(parsed)) {
				continue
			}

			if (event.event === "error") {
				latestError = parsed
				continue
			}

			const response = parsed.response
			if (isRecord(response)) {
				latestResponse = response
			}
		} catch {}
	}

	if (latestResponse) {
		return latestResponse
	}

	throw new Error(
		`No completed response found in SSE stream.${
			latestError ? ` Last error: ${summarizeUpstreamError(latestError)}` : ""
		}`,
	)
}
