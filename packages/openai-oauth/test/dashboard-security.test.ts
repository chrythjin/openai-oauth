import { describe, expect, test } from "vitest"
import {
	isValidDashboardOrigin,
	requireDashboardOrigin,
} from "../src/dashboard-security.js"

const request = (headers: HeadersInit, port = 47631) =>
	new Request(`http://127.0.0.1:${port}/api/tokens/switch`, {
		method: "POST",
		headers,
	})

describe("dashboard security origin policy", () => {
	test.each([
		["127.0.0.1", "http://127.0.0.1:47631"],
		["localhost", "http://localhost:47631"],
	])("accepts exact local origin for %s", (_label, origin) => {
		expect(isValidDashboardOrigin(request({ Origin: origin }))).toBe(true)
		expect(requireDashboardOrigin(request({ Origin: origin }))).toBeNull()
	})

	test.each([
		["missing origin and referer", {}],
		["null origin", { Origin: "null" }],
		["wrong host", { Origin: "http://evil.example" }],
		["wrong port", { Origin: "http://127.0.0.1:10531" }],
		["malformed referer", { Referer: "not a url" }],
	])("rejects %s", (_label, headers) => {
		const response = requireDashboardOrigin(request(headers))

		expect(response?.status).toBe(403)
		expect(response?.headers.get("content-type")).toBe(
			"text/plain; charset=utf-8",
		)
	})

	test("uses Referer origin only when Origin is absent", () => {
		expect(
			isValidDashboardOrigin(
				request({ Referer: "http://localhost:47631/dashboard?tab=tokens" }),
			),
		).toBe(true)
	})

	test("Origin is authoritative when Referer conflicts", () => {
		expect(
			isValidDashboardOrigin(
				request({
					Origin: "http://127.0.0.1:47631",
					Referer: "http://evil.example/dashboard",
				}),
			),
		).toBe(true)

		expect(
			isValidDashboardOrigin(
				request({
					Origin: "http://evil.example",
					Referer: "http://127.0.0.1:47631/dashboard",
				}),
			),
		).toBe(false)
	})
})
