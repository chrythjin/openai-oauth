import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
	deleteTokenSlot,
	loadVaultConfig,
	rotateToken,
	saveVaultConfig,
	switchToken,
	type VaultConfig,
	type VaultPaths,
} from "../src/vault-ops.js"

const roots: string[] = []

const createAuth = (subject: string) =>
	JSON.stringify(
		{
			profile: { email: `${subject}@example.test` },
			tokens: { access_token: `access-${subject}` },
		},
		null,
		2,
	)

const createVaultFixture = async (): Promise<VaultPaths> => {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "openai-oauth-vault-ops-"),
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

	const config: VaultConfig = {
		current: "auth.json",
		tokens: [
			{ file: "auth.json", label: "Account 1", active: true },
			{ file: "auth-alt1.json", label: "Account 2", active: false },
			{ file: "auth-alt2.json", label: "Account 3", active: false },
			{ file: "auth-alt3.json", label: "Account 4", active: false },
		],
	}

	await fs.writeFile(paths.configFile, JSON.stringify(config, null, 2), "utf-8")
	for (const token of config.tokens) {
		await fs.writeFile(
			path.join(paths.vaultDir, token.file),
			createAuth(token.file),
			"utf-8",
		)
	}
	await fs.writeFile(
		path.join(root, "auth.json"),
		createAuth("root-active"),
		"utf-8",
	)
	await fs.writeFile(
		path.join(paths.activeDir, "auth.json"),
		createAuth("active-copy"),
		"utf-8",
	)

	return paths
}

const assertSingleActiveToken = (config: VaultConfig) => {
	const activeTokens = config.tokens.filter((token) => token.active)
	expect(activeTokens).toHaveLength(1)
	expect(config.current).toBe(activeTokens[0]?.file)
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await fs.rm(root, { recursive: true, force: true })
	}
})

describe("vault operations", () => {
	test("serializes concurrent switch, rotate, and delete mutations", async () => {
		const paths = await createVaultFixture()

		const results = await Promise.allSettled([
			switchToken(paths, "2"),
			rotateToken(paths),
			deleteTokenSlot(paths, 4),
			switchToken(paths, "3"),
		])

		expect(results.every((result) => result.status === "fulfilled")).toBe(true)

		const rawConfig = await fs.readFile(paths.configFile, "utf-8")
		expect(() => JSON.parse(rawConfig)).not.toThrow()
		const config = loadVaultConfig(paths)
		assertSingleActiveToken(config)
		expect(config.tokens.some((token) => token.file === "auth-alt3.json")).toBe(
			false,
		)
		expect(
			await fs.readFile(path.join(paths.activeDir, "auth.json"), "utf-8"),
		).toMatch(/^\{/)
		expect(
			await fs.readFile(path.join(paths.authDir, "auth.json"), "utf-8"),
		).toMatch(/^\{/)
	})

	test("blocks active slot deletion with a non-sensitive message", async () => {
		const paths = await createVaultFixture()

		const result = await deleteTokenSlot(paths, 1)

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toBe("Cannot delete the active slot. Switch first.")
			expect(result.error).not.toContain(paths.authDir)
			expect(result.error).not.toContain("auth.json")
		}
		assertSingleActiveToken(loadVaultConfig(paths))
	})

	test("rejects unsafe config filenames before writing escaped paths", async () => {
		const paths = await createVaultFixture()

		expect(() =>
			saveVaultConfig(paths, {
				current: "..\\auth.json",
				tokens: [{ file: "..\\auth.json", label: "Escape", active: true }],
			}),
		).toThrow("Unsafe token filename")
		expect(await fs.readdir(path.dirname(paths.authDir))).not.toContain(
			"auth.json",
		)
	})
})
