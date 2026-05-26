export function getExpectedOrigins(request: Request): [string, string] {
	const { port } = new URL(request.url)
	const expectedPort = port || "10531"
	return [
		`http://127.0.0.1:${expectedPort}`,
		`http://localhost:${expectedPort}`,
	]
}

function getRequestOrigin(request: Request): string | null {
	const origin = request.headers.get("origin")
	if (origin) return origin

	const referer = request.headers.get("referer")
	if (!referer) return null

	try {
		return new URL(referer).origin
	} catch {
		return null
	}
}

export function isValidDashboardOrigin(request: Request): boolean {
	const origin = getRequestOrigin(request)
	if (!origin) return false

	return getExpectedOrigins(request).includes(origin)
}

export function requireDashboardOrigin(request: Request): Response | null {
	if (isValidDashboardOrigin(request)) return null

	return new Response("Forbidden", {
		status: 403,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	})
}

export function getSecurityHeaders(): Record<string, string> {
	return {
		"Content-Security-Policy":
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
	}
}
