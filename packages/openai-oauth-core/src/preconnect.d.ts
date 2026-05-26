// Chrome-specific fetch extension for HTTP/2 preconnect optimization
// Used conditionally at runtime: `typeof fetch.preconnect === "function"`

export {}
declare global {
	interface Function {
		preconnect?: (
			input: RequestInfo | URL,
			init?: RequestInit | undefined,
		) => Promise<Response>
	}
}
