/**
 * Vault Operations — Pure core extracted from .codex/scripts/token-rotator.js
 *
 * Thread-safe, no side-effects (no console.log, no process.exit).
 * All paths are configurable; no implicit globals.
 */

import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	renameSync,
	unlinkSync,
	writeSync,
} from "node:fs"
import { dirname, join } from "node:path"

// ── Types ──────────────────────────────────────────────────────

export type TokenSlot = {
	file: string
	label: string
	active: boolean
}

export type VaultConfig = {
	current: string
	tokens: TokenSlot[]
}

export type VaultPaths = {
	authDir: string
	vaultDir: string
	activeDir: string
	backupDir: string
	configFile: string
}

export type TokenSwitchResult = {
	prev: TokenSlot
	next: TokenSlot
}

export type TokenSlotInfo = {
	slot: number
	file: string
	label: string
	active: boolean
	inVault: boolean
	expiry: string | null
}

// ── Mutex ──────────────────────────────────────────────────────

let vaultMutex: Promise<void> = Promise.resolve()

const withVaultLock = async <T>(fn: () => T | Promise<T>): Promise<T> => {
	const prev = vaultMutex
	let release: () => void
	vaultMutex = new Promise<void>((resolve) => {
		release = resolve
	})
	await prev
	try {
		return await fn()
	} finally {
		release!()
	}
}

// ── Path Resolution ────────────────────────────────────────────

export const resolveVaultPaths = (authDir?: string): VaultPaths => {
	const codexHome = process.env.CODEX_HOME
	const userHome = process.env.USERPROFILE || process.env.HOME || ""
	const home = authDir ?? codexHome ?? join(userHome, ".codex")

	return {
		authDir: home,
		vaultDir: join(home, "vault"),
		activeDir: join(home, "active"),
		backupDir: join(home, "backups"),
		configFile: join(home, "token-rotator-config.json"),
	}
}

const SAFE_FILENAME_RE = /^auth(?:-alt\d+)?\.json$/

const assertSafeTokenFilename = (filename: string): void => {
	if (!SAFE_FILENAME_RE.test(filename)) {
		throw new Error(`Unsafe token filename: ${filename}`)
	}
}

// ── Config ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: VaultConfig = {
	current: "auth.json",
	tokens: [
		{ file: "auth.json", label: "Account 1", active: true },
		{ file: "auth-alt1.json", label: "Account 2", active: false },
	],
}

const ensureDirs = (paths: VaultPaths): void => {
	for (const dir of [
		paths.authDir,
		paths.vaultDir,
		paths.activeDir,
		paths.backupDir,
	]) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
		}
	}
}

const atomicWriteFile = (
	targetPath: string,
	contents: string | Buffer,
): void => {
	const dir = dirname(targetPath)
	mkdirSync(dir, { recursive: true })
	const tempPath = join(
		dir,
		`.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
	)
	let fd: number | null = null
	try {
		fd = openSync(tempPath, "wx")
		if (typeof contents === "string") {
			writeSync(fd, contents)
		} else {
			writeSync(fd, contents)
		}
		fsyncSync(fd)
		closeSync(fd)
		fd = null
		renameSync(tempPath, targetPath)
	} catch (error) {
		if (fd !== null) {
			try {
				closeSync(fd)
			} catch {}
		}
		try {
			unlinkSync(tempPath)
		} catch {}
		throw error
	}
}

const atomicCopyFile = (sourcePath: string, targetPath: string): void => {
	const fd = openSync(sourcePath, "r")
	try {
		const chunks: Buffer[] = []
		const buffer = Buffer.alloc(64 * 1024)
		while (true) {
			const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
			if (bytesRead === 0) break
			chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
		}
		atomicWriteFile(targetPath, Buffer.concat(chunks))
	} finally {
		closeSync(fd)
	}
}

export const loadVaultConfig = (paths: VaultPaths): VaultConfig => {
	ensureDirs(paths)
	if (!existsSync(paths.configFile)) {
		atomicWriteFile(paths.configFile, JSON.stringify(DEFAULT_CONFIG, null, 2))
		return structuredClone(DEFAULT_CONFIG)
	}

	try {
		const content = readFileSync(paths.configFile, "utf-8")
		const parsed = JSON.parse(content.replace(/^\uFEFF/, ""))
		for (const token of parsed.tokens ?? []) {
			assertSafeTokenFilename(token.file)
		}
		assertSafeTokenFilename(parsed.current)
		return parsed as VaultConfig
	} catch {
		return structuredClone(DEFAULT_CONFIG)
	}
}

export const saveVaultConfig = (
	paths: VaultPaths,
	config: VaultConfig,
): void => {
	assertSafeTokenFilename(config.current)
	for (const token of config.tokens) {
		assertSafeTokenFilename(token.file)
	}
	atomicWriteFile(paths.configFile, JSON.stringify(config, null, 2))
}

// ── File Path Helpers ──────────────────────────────────────────

const vaultPath = (paths: VaultPaths, filename: string): string =>
	join(paths.vaultDir, filename)

const activePath = (paths: VaultPaths): string =>
	join(paths.activeDir, "auth.json")

const backupPath = (paths: VaultPaths, name: string): string =>
	join(paths.backupDir, name)

// ── Token Expiry ───────────────────────────────────────────────

const parseJwtExpiry = (token: string): Date | null => {
	try {
		const payload = token.split(".")[1]
		if (!payload) return null
		const decoded = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf-8"),
		)
		if (typeof decoded.exp === "number") {
			return new Date(decoded.exp * 1000)
		}
		return null
	} catch {
		return null
	}
}

export const readTokenExpiry = (
	paths: VaultPaths,
	filename: string,
): string | null => {
	const activeFile = join(paths.authDir, "auth.json")
	const vaultFile = vaultPath(paths, filename)

	for (const file of [activeFile, vaultFile]) {
		try {
			const raw = JSON.parse(readFileSync(file, "utf-8"))
			const token =
				raw?.accessToken ??
				raw?.access_token ??
				raw?.session?.accessToken ??
				raw?.session?.access_token

			if (typeof token === "string") {
				const expiry = parseJwtExpiry(token)
				if (expiry) return expiry.toISOString()
			}
		} catch {}
	}
	return null
}

// ── Slot Listing ───────────────────────────────────────────────

export const listTokenSlots = (paths: VaultPaths): TokenSlotInfo[] => {
	const config = loadVaultConfig(paths)
	return config.tokens.map((token, index) => ({
		slot: index + 1,
		file: token.file,
		label: token.label,
		active: token.active,
		inVault: existsSync(vaultPath(paths, token.file)),
		expiry: readTokenExpiry(paths, token.file),
	}))
}

// ── Internal Ops ───────────────────────────────────────────────

const backupActive = (paths: VaultPaths, filename: string): string | null => {
	const src = activePath(paths)
	if (!existsSync(src)) return null

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const name = `backup-${timestamp}-${filename}`
	atomicCopyFile(src, backupPath(paths, name))
	return name
}

const restoreToActive = (paths: VaultPaths, filename: string): boolean => {
	const src = vaultPath(paths, filename)
	if (!existsSync(src)) return false

	// Cleanup stale copies
	try {
		for (const entry of readdirSync(paths.activeDir)) {
			if (entry !== "auth.json") {
				try {
					unlinkSync(join(paths.activeDir, entry))
				} catch {}
			}
		}
	} catch {}

	const dst = activePath(paths)
	atomicCopyFile(src, dst)
	atomicCopyFile(src, join(paths.authDir, "auth.json"))
	return true
}

const findToken = (
	config: VaultConfig,
	labelOrIdx: string,
): TokenSlot | null => {
	const target = String(labelOrIdx).trim()

	const altMatch = target.match(/^ALT\s*(\d+)$/i)
	if (altMatch?.[1]) {
		const altNum = Number.parseInt(altMatch[1], 10)
		return config.tokens[altNum] ?? null
	}

	const numericIdx = Number.parseInt(target, 10)
	if (!Number.isNaN(numericIdx) && String(numericIdx) === target) {
		return config.tokens[numericIdx - 1] ?? null
	}

	const normalizedTarget = target.toLowerCase()
	return (
		config.tokens.find(
			(t) =>
				t.file.toLowerCase() === normalizedTarget ||
				t.label.toLowerCase() === normalizedTarget ||
				t.label.toLowerCase().includes(normalizedTarget),
		) ?? null
	)
}

// ── Public Ops ─────────────────────────────────────────────────

export const switchToken = async (
	paths: VaultPaths,
	labelOrIdx: string,
): Promise<
	| { success: true; result: TokenSwitchResult }
	| { success: false; error: string }
> => {
	return withVaultLock(() => {
		const config = loadVaultConfig(paths)
		const target = findToken(config, labelOrIdx)

		if (!target) {
			return { success: false, error: `Token not found: ${labelOrIdx}` }
		}

		if (!existsSync(vaultPath(paths, target.file))) {
			return { success: false, error: `No vault entry for ${target.file}` }
		}

		const currentIdx = config.tokens.findIndex(
			(t) => t.active || t.file === config.current,
		)
		const prevToken: TokenSlot =
			currentIdx >= 0 ? config.tokens[currentIdx]! : target

		if (currentIdx >= 0) {
			backupActive(paths, prevToken.file)
		}

		restoreToActive(paths, target.file)

		config.current = target.file
		const targetIdx = config.tokens.indexOf(target)
		config.tokens.forEach((t, i) => {
			t.active = i === targetIdx
		})
		saveVaultConfig(paths, config)

		return {
			success: true,
			result: {
				prev: prevToken,
				next: target,
			},
		}
	})
}

export const rotateToken = async (
	paths: VaultPaths,
): Promise<
	| { success: true; result: TokenSwitchResult }
	| { success: false; error: string }
> => {
	return withVaultLock(() => {
		const config = loadVaultConfig(paths)
		let currentIdx = config.tokens.findIndex((t) => t.active)
		if (currentIdx < 0) {
			currentIdx = config.tokens.findIndex((t) => t.file === config.current)
		}
		if (currentIdx < 0) {
			return { success: false, error: "No active token found" }
		}
		const prevToken = config.tokens[currentIdx]!

		// Find next available slot with vault entry
		let nextIdx = (currentIdx + 1) % config.tokens.length
		let attempts = 0
		while (attempts < config.tokens.length - 1) {
			const nextToken = config.tokens[nextIdx]!
			if (
				nextIdx !== currentIdx &&
				existsSync(vaultPath(paths, nextToken.file))
			) {
				break
			}
			nextIdx = (nextIdx + 1) % config.tokens.length
			attempts++
		}

		if (attempts >= config.tokens.length - 1 || nextIdx === currentIdx) {
			return { success: false, error: "No other token with vault entry found" }
		}
		const nextToken = config.tokens[nextIdx]!

		backupActive(paths, prevToken.file)
		restoreToActive(paths, nextToken.file)

		config.current = nextToken.file
		config.tokens.forEach((t, i) => {
			t.active = i === nextIdx
		})
		saveVaultConfig(paths, config)

		return {
			success: true,
			result: {
				prev: prevToken,
				next: nextToken,
			},
		}
	})
}

export const addTokenToVault = async (
	paths: VaultPaths,
	sourcePath: string,
): Promise<
	{ success: true; slot: TokenSlotInfo } | { success: false; error: string }
> => {
	return withVaultLock(() => {
		if (!existsSync(sourcePath)) {
			return { success: false, error: "Source file not found." }
		}

		const config = loadVaultConfig(paths)
		const used = new Set(config.tokens.map((t) => t.file))

		let destFile = "auth.json"
		if (used.has(destFile) || existsSync(vaultPath(paths, destFile))) {
			let index = 1
			while (true) {
				const candidate = `auth-alt${index}.json`
				if (!used.has(candidate) && !existsSync(vaultPath(paths, candidate))) {
					destFile = candidate
					break
				}
				index++
			}
		}

		atomicCopyFile(sourcePath, vaultPath(paths, destFile))

		const existingIdx = config.tokens.findIndex((t) => t.file === destFile)
		if (existingIdx < 0) {
			config.tokens.push({
				file: destFile,
				label: `Account ${config.tokens.length + 1}`,
				active: false,
			})
			saveVaultConfig(paths, config)
		}

		const slotIdx = config.tokens.findIndex((t) => t.file === destFile)
		const addedToken = config.tokens[slotIdx]!
		return {
			success: true,
			slot: {
				slot: slotIdx + 1,
				file: destFile,
				label: addedToken.label,
				active: false,
				inVault: true,
				expiry: readTokenExpiry(paths, destFile),
			},
		}
	})
}

export const deleteTokenSlot = async (
	paths: VaultPaths,
	slotNumber: number,
): Promise<
	{ success: true; deleted: TokenSlot } | { success: false; error: string }
> => {
	return withVaultLock(() => {
		const config = loadVaultConfig(paths)
		const slotIndex = slotNumber - 1
		const token = config.tokens[slotIndex]

		if (!token) {
			return { success: false, error: `Token slot not found: ${slotNumber}` }
		}

		if (token.active || token.file === config.current) {
			return {
				success: false,
				error: "Cannot delete the active slot. Switch first.",
			}
		}

		// Backup before deletion
		backupActive(paths, token.file)

		const vp = vaultPath(paths, token.file)
		if (existsSync(vp)) {
			unlinkSync(vp)
		}

		config.tokens.splice(slotIndex, 1)
		saveVaultConfig(paths, config)

		return { success: true, deleted: token }
	})
}

export const isProxyHealthy = async (port = 10531): Promise<boolean> => {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/health`, {
			signal: AbortSignal.timeout(1000),
		})
		if (!response.ok) return false
		const payload = (await response.json()) as { ok?: boolean }
		return payload?.ok === true
	} catch {
		return false
	}
}

export const getActiveTokenInfo = (paths: VaultPaths): TokenSlotInfo | null => {
	const config = loadVaultConfig(paths)
	const active = config.tokens.find((t) => t.active)
	if (!active) return null
	return {
		slot: config.tokens.indexOf(active) + 1,
		file: active.file,
		label: active.label,
		active: true,
		inVault: existsSync(vaultPath(paths, active.file)),
		expiry: readTokenExpiry(paths, active.file),
	}
}
