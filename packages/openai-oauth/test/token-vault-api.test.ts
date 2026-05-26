import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { handleTokenApiRequest } from "../src/token-vault-api.js"
import type { VaultPaths } from "../src/vault-ops.js"

const PORT = 47631
const BASE_URL = `http://127.0.0.1:${PORT}`
const SENSITIVE_ACCESS_TOKEN = "fixture-access-token-do-not-leak"
const SENSITIVE_REFRESH_TOKEN = "fixture-refresh-token-do-not-leak"

const roots: string[] = []

const createFixtureAuth = (subject: string) =>
	JSON.stringify(
		{
			tokens: {
				access_token: SENSITIVE_ACCESS_TOKEN,
				refresh_token: SENSITIVE_REFRESH_TOKEN,
			},
			profile: {
				email: `${subject}@example.test`,
			},
			source: `CODEX_HOME/temp/${subject}/auth.json`,
		},
		null,
		2,
	)

const createVaultFixture = async (): Promise<VaultPaths> => {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "openai-oauth-token-api-"),
	)
	roots.push(root)

	const paths: VaultPaths = {
		authDir: root,
		vaultDir: path.join(root, "vault"),
		activeDir: path.join(root, "active"),
		backupDir: path.join(root, "backups"),
		configFile: path.join(root, "token-rotator-config.json"),
	}

	await fs.mkdir(paths.vaultDir, { recursive: true })
	await fs.mkdir(paths.activeDir, { recursive: true })
	await fs.mkdir(paths.backupDir, { recursive: true })
	await fs.writeFile(
		paths.configFile,
		JSON.stringify(
			{
				current: "auth.json",
				tokens: [
					{ file: "auth.json", label: "Account 1", active: true },
					{ file: "auth-alt1.json", label: "Account 2", active: false },
				],
			},
			null,
			2,
		),
		"utf-8",
	)
	await fs.writeFile(
		path.join(root, "auth.json"),
		createFixtureAuth("active"),
		"utf-8",
	)
	await fs.writeFile(
		path.join(paths.activeDir, "auth.json"),
		createFixtureAuth("active-copy"),
		"utf-8",
	)
	await fs.writeFile(
		path.join(paths.vaultDir, "auth.json"),
		createFixtureAuth("slot-one"),
		"utf-8",
	)
	await fs.writeFile(
		path.join(paths.vaultDir, "auth-alt1.json"),
		createFixtureAuth("slot-two"),
		"utf-8",
	)

	return paths
}

const tokenRequest = (pathname: string, init: RequestInit = {}): Request =>
	new Request(`${BASE_URL}${pathname}`, {
		...init,
		headers: {
			"content-type": "application/json",
			...init.headers,
		},
	})

const assertNoSensitiveData = (body: string) => {
	expect(body).not.toContain("access_token")
	expect(body).not.toContain("refresh_token")
	expect(body).not.toContain(SENSITIVE_ACCESS_TOKEN)
	expect(body).not.toContain(SENSITIVE_REFRESH_TOKEN)
	expect(body).not.toContain("auth.json")
	expect(body).not.toContain("openai-oauth-token-api-")
	expect(body).not.toContain("CODEX_HOME")
	expect(body).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
}

const readResponse = async (response: Response) => {
	const body = await response.text()
	assertNoSensitiveData(body)
	return body
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await fs.rm(root, { recursive: true, force: true })
	}
})

describe("token vault API security", () => {
	test("GET /api/tokens/slots does not expose wildcard CORS or sensitive fields", async () => {
		const paths = await createVaultFixture()
		const response = await handleTokenApiRequest(
			tokenRequest("/api/tokens/slots", { method: "GET" }),
			paths,
		)

		expect(response.status).toBe(200)
		expect(response.headers.get("access-control-allow-origin")).not.toBe("*")
		const body = await readResponse(response)
		expect(JSON.parse(body)).toEqual({
			slots: [
				{
					slot: 1,
					label: "Account 1",
					active: true,
					inVault: true,
					expiry: null,
				},
				{
					slot: 2,
					label: "Account 2",
					active: false,
					inVault: true,
					expiry: null,
				},
			],
		})
	})

	test.each([
		["switch", "/api/tokens/switch", "POST", JSON.stringify({ slot: 2 })],
		["rotate", "/api/tokens/rotate", "POST", undefined],
		["delete", "/api/tokens/slots/2", "DELETE", undefined],
	])("accepts exact local Origin for %s", async (_label, pathname, method, body) => {
		for (const origin of [
			`http://127.0.0.1:${PORT}`,
			`http://localhost:${PORT}`,
		]) {
			const paths = await createVaultFixture()
			const response = await handleTokenApiRequest(
				tokenRequest(pathname, {
					method,
					headers: { Origin: origin },
					body,
				}),
				paths,
			)

			expect(response.status).toBe(200)
			await readResponse(response)
		}
	})

	test.each([
		["switch", "/api/tokens/switch", "POST", JSON.stringify({ slot: 2 })],
		["rotate", "/api/tokens/rotate", "POST", undefined],
		["delete", "/api/tokens/slots/2", "DELETE", undefined],
	])("rejects unsafe %s requests without a valid same-origin source", async (_label, pathname, method, body) => {
		const cases: Array<[string, HeadersInit]> = [
			["missing Origin and Referer", {}],
			["null Origin", { Origin: "null" }],
			["invalid Origin", { Origin: "http://evil.example" }],
			["malformed Referer", { Referer: "not a url" }],
			[
				"conflicting invalid Origin with valid Referer",
				{
					Origin: "http://evil.example",
					Referer: `http://127.0.0.1:${PORT}/dashboard`,
				},
			],
		]

		for (const [_caseName, headers] of cases) {
			const paths = await createVaultFixture()
			const response = await handleTokenApiRequest(
				tokenRequest(pathname, { method, headers, body }),
				paths,
			)

			expect(response.status).toBe(403)
			const responseBody = await response.text()
			expect(responseBody).toBe("Forbidden")
			assertNoSensitiveData(responseBody)
		}
	})

	test("falls back to Referer origin when Origin is absent", async () => {
		const paths = await createVaultFixture()
		const response = await handleTokenApiRequest(
			tokenRequest("/api/tokens/switch", {
				method: "POST",
				headers: { Referer: `http://localhost:${PORT}/dashboard` },
				body: JSON.stringify({ slot: 2 }),
			}),
			paths,
		)

		expect(response.status).toBe(200)
		await readResponse(response)
	})

	test("uses Origin as authoritative when Referer conflicts", async () => {
		const allowedPaths = await createVaultFixture()
		const allowed = await handleTokenApiRequest(
			tokenRequest("/api/tokens/switch", {
				method: "POST",
				headers: {
					Origin: `http://127.0.0.1:${PORT}`,
					Referer: "http://evil.example/dashboard",
				},
				body: JSON.stringify({ slot: 2 }),
			}),
			allowedPaths,
		)

		expect(allowed.status).toBe(200)
		await readResponse(allowed)

		const rejectedPaths = await createVaultFixture()
		const rejected = await handleTokenApiRequest(
			tokenRequest("/api/tokens/switch", {
				method: "POST",
				headers: {
					Origin: "http://evil.example",
					Referer: `http://127.0.0.1:${PORT}/dashboard`,
				},
				body: JSON.stringify({ slot: 2 }),
			}),
			rejectedPaths,
		)

		expect(rejected.status).toBe(403)
		expect(await rejected.text()).toBe("Forbidden")
	})

	describe("POST /api/tokens/add", () => {
		test("saves default auth.json as a new vault slot", async () => {
			const paths = await createVaultFixture()
			const response = await handleTokenApiRequest(
				tokenRequest("/api/tokens/add", {
					method: "POST",
					headers: { Origin: `http://127.0.0.1:${PORT}` },
				}),
				paths,
			)

			expect(response.status).toBe(200)
			const body = await readResponse(response)
			const parsed = JSON.parse(body)
			expect(parsed.success).toBe(true)
			expect(parsed.slot).toEqual({
				slot: 3,
				label: "Account 3",
				active: false,
				inVault: true,
				expiry: null,
			})
		})

		test("response does not include restart_required", async () => {
			const paths = await createVaultFixture()
			const response = await handleTokenApiRequest(
				tokenRequest("/api/tokens/add", {
					method: "POST",
					headers: { Origin: `http://127.0.0.1:${PORT}` },
				}),
				paths,
			)

			expect(response.status).toBe(200)
			const body = await readResponse(response)
			const parsed = JSON.parse(body)
			expect(parsed).not.toHaveProperty("restart_required")
		})

		test("rejects custom sourcePath with 400 invalid_request_error", async () => {
			const paths = await createVaultFixture()
			const response = await handleTokenApiRequest(
				tokenRequest("/api/tokens/add", {
					method: "POST",
					headers: { Origin: `http://127.0.0.1:${PORT}` },
					body: JSON.stringify({ sourcePath: "/etc/passwd" }),
				}),
				paths,
			)

			expect(response.status).toBe(400)
			const body = await response.text()
			assertNoSensitiveData(body)
			const parsed = JSON.parse(body)
			expect(parsed.error.message).toBe(
				"Custom source path import is not supported.",
			)
			expect(parsed.error.type).toBe("invalid_request_error")
		})

		test("rejects unsafe requests without a valid same-origin source", async () => {
			const cases: Array<[string, HeadersInit]> = [
				["missing Origin and Referer", {}],
				["null Origin", { Origin: "null" }],
				["invalid Origin", { Origin: "http://evil.example" }],
				["malformed Referer", { Referer: "not a url" }],
				[
					"conflicting invalid Origin with valid Referer",
					{
						Origin: "http://evil.example",
						Referer: `http://127.0.0.1:${PORT}/dashboard`,
					},
				],
			]

			for (const [_caseName, headers] of cases) {
				const paths = await createVaultFixture()
				const response = await handleTokenApiRequest(
					tokenRequest("/api/tokens/add", { method: "POST", headers }),
					paths,
				)

				expect(response.status).toBe(403)
				const responseBody = await response.text()
				expect(responseBody).toBe("Forbidden")
				assertNoSensitiveData(responseBody)
			}
		})

		test("handles malformed body gracefully by using default source", async () => {
			const paths = await createVaultFixture()
			const response = await handleTokenApiRequest(
				tokenRequest("/api/tokens/add", {
					method: "POST",
					headers: { Origin: `http://127.0.0.1:${PORT}` },
					body: "{ not valid json",
				}),
				paths,
			)

			expect(response.status).toBe(200)
			const body = await readResponse(response)
			const parsed = JSON.parse(body)
			expect(parsed.success).toBe(true)
			expect(parsed.slot.slot).toBe(3)
		})
	})
})
