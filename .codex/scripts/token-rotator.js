/**
 * Token Rotator - Safe Vault System
 *
 * Vault: 원본 토큰 저장 (절대 덮어쓰지 않음)
 * Active: 실제로 사용할 토큰 (vault에서 복사)
 * Backups: 전환時 자동 백업
 *
 * Usage:
 *   bun token-rotator.js --status     # Show current token
 *   bun token-rotator.js --rotate      # Rotate to next token
 *   bun token-rotator.js --use 1       # Switch to Account 1
 *   bun token-rotator.js --vault add   # Add token to vault
 */

import { execFileSync, execSync, spawn } from "node:child_process"
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"

const SCRIPT_FILE = fileURLToPath(import.meta.url)
const __dirname = dirname(SCRIPT_FILE)
const REPO_ROOT = resolve(__dirname, "..", "..")
const DEFAULT_PORT = 10531
const DEFAULT_HOST = "127.0.0.1"
const HEALTH_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/health`

function resolveAuthDir() {
	if (process.env.CODEX_HOME) {
		return resolve(process.env.CODEX_HOME)
	}

	const home = process.env.USERPROFILE || process.env.HOME
	if (!home) {
		throw new Error(
			"Unable to resolve home directory; set CODEX_HOME explicitly",
		)
	}

	return join(home, ".codex")
}

const AUTH_DIR = resolveAuthDir()
const VAULT_DIR = join(AUTH_DIR, "vault")
const ACTIVE_DIR = join(AUTH_DIR, "active")
const BACKUP_DIR = join(AUTH_DIR, "backups")
const CONFIG_FILE = join(AUTH_DIR, "token-rotator-config.json")

const DEFAULT_CONFIG = {
	current: "auth.json",
	tokens: [
		{ file: "auth.json", label: "Account 1", active: true },
		{ file: "auth-alt1.json", label: "Account 2", active: false },
	],
}

function assertSafeTokenFilename(filename) {
	if (
		typeof filename !== "string" ||
		!/^auth(?:-alt\d+)?\.json$/.test(filename)
	) {
		throw new Error(`Unsafe token filename in config: ${filename}`)
	}
}

function validateConfig(config) {
	assertSafeTokenFilename(config.current)
	for (const token of config.tokens) {
		assertSafeTokenFilename(token.file)
	}
	return config
}

function ensureDirs() {
	for (const dir of [VAULT_DIR, ACTIVE_DIR, BACKUP_DIR]) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
		}
	}
}

function loadConfig() {
	ensureDirs()
	if (!existsSync(CONFIG_FILE)) {
		writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
		return DEFAULT_CONFIG
	}

	let parsed
	try {
		const content = readFileSync(CONFIG_FILE, "utf-8")
		parsed = JSON.parse(content.replace(/^\uFEFF/, ""))
	} catch {
		return DEFAULT_CONFIG
	}

	return validateConfig(parsed)
}

function saveConfig(config) {
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

function getVaultPath(filename) {
	return join(VAULT_DIR, filename)
}

function getActivePath(filename = "auth.json") {
	return join(ACTIVE_DIR, filename)
}

function getBackupPath(filename) {
	return join(BACKUP_DIR, filename)
}

function cleanupActiveCopies() {
	try {
		if (!existsSync(ACTIVE_DIR)) {
			return
		}

		for (const entry of readdirSync(ACTIVE_DIR)) {
			if (entry !== "auth.json") {
				try {
					unlinkSync(join(ACTIVE_DIR, entry))
				} catch {}
			}
		}
	} catch {}
}

function restoreToActive(filename) {
	const vaultPath = getVaultPath(filename)
	const activePath = getActivePath()

	if (!existsSync(vaultPath)) {
		return false
	}

	cleanupActiveCopies()
	copyFileSync(vaultPath, activePath)
	copyFileSync(vaultPath, join(AUTH_DIR, "auth.json"))
	return true
}

function pruneBackups(maxKeep = 10) {
	try {
		if (!existsSync(BACKUP_DIR)) {
			return
		}

		const entries = readdirSync(BACKUP_DIR)
			.filter((file) => file.endsWith(".json"))
			.map((file) => {
				const fullPath = join(BACKUP_DIR, file)
				const stat = statSync(fullPath)
				return { file, fullPath, mtime: stat.mtimeMs }
			})

		if (entries.length <= maxKeep) {
			return
		}

		// Sort by mtime ascending (oldest first)
		entries.sort((a, b) => a.mtime - b.mtime)

		const toDeleteCount = entries.length - maxKeep
		for (let i = 0; i < toDeleteCount; i++) {
			try {
				unlinkSync(entries[i].fullPath)
			} catch {}
		}
	} catch {}
}

function backupActive(filename) {
	const activePath = getActivePath()

	if (!existsSync(activePath)) {
		return null
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const backupName = `backup-${timestamp}-${filename}`
	const backupPath = getBackupPath(backupName)

	copyFileSync(activePath, backupPath)
	pruneBackups()
	return backupName
}

function showStatus() {
	const config = loadConfig()
	const currentLabel = config.tokens.find((t) => t.active)?.label || "Unknown"

	console.log("\n=== Token Rotator (Vault System) ===")
	console.log(`Platform: ${process.platform}`)
	console.log(`Auth root: ${AUTH_DIR}`)
	console.log(`Current: ${config.current} (${currentLabel})`)
	console.log(`\nVault: ${VAULT_DIR}`)
	console.log(`Active: ${ACTIVE_DIR}`)
	console.log(`Backup: ${BACKUP_DIR}`)

	console.log("\nTokens:")
	config.tokens.forEach((t) => {
		const inVault = existsSync(getVaultPath(t.file))
		const marker = t.active ? " [ACTIVE]" : ""
		const vaultMarker = inVault ? "(vault)" : "(no vault)"
		console.log(`  ${t.label}: ${t.file}${marker} ${vaultMarker}`)
	})
	console.log()
}

function showTokenSlots() {
	const config = loadConfig()
	console.log("\nToken slots:")
	config.tokens.forEach((token, index) => {
		const marker = token.active ? " [ACTIVE]" : ""
		const vaultMarker = existsSync(getVaultPath(token.file))
			? "vault"
			: "missing"
		console.log(
			`  ${index + 1}. ${token.label} (${token.file})${marker} - ${vaultMarker}`,
		)
	})
	console.log()
}

function getPortProcessIds() {
	try {
		const output = execSync(`lsof -nP -iTCP:${DEFAULT_PORT} -sTCP:LISTEN -t`, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		})
		return output
			.split(/\r?\n/)
			.map((line) => Number.parseInt(line.trim(), 10))
			.filter((pid) => !Number.isNaN(pid) && pid > 0)
	} catch {
		return []
	}
}

async function showRuntimeStatus() {
	showStatus()
	if (process.platform === "win32") {
		return
	}

	const pidFile = join(REPO_ROOT, ".codex", "proxy.pid")
	const pids = getPortProcessIds()
	console.log("Runtime:")
	console.log(
		`  pid file : ${existsSync(pidFile) ? readFileSync(pidFile, "utf-8").trim() : "missing"}`,
	)
	console.log(`  port     : ${DEFAULT_PORT}`)
	console.log(`  pids     : ${pids.length > 0 ? pids.join(", ") : "none"}`)
	console.log(`  health   : ${(await isProxyHealthy()) ? "ok" : "unavailable"}`)
	console.log()
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function isProxyHealthy() {
	try {
		const response = await fetch("http://127.0.0.1:10531/health", {
			signal: AbortSignal.timeout(1000),
		})

		if (!response.ok) {
			return false
		}

		const payload = await response.json()
		return payload?.ok === true
	} catch {
		return false
	}
}

async function waitForProxyStart(child, timeoutMs = 10000) {
	return new Promise((resolve) => {
		let settled = false

		const finish = (value) => {
			if (settled) {
				return
			}

			settled = true
			child.removeListener("error", onError)
			child.removeListener("exit", onExit)
			resolve(value)
		}

		const onError = () => finish(false)
		const onExit = () => finish(false)

		child.once("error", onError)
		child.once("exit", onExit)

		void (async () => {
			const deadline = Date.now() + timeoutMs

			while (Date.now() < deadline) {
				if (await isProxyHealthy()) {
					finish(true)
					return
				}

				await sleep(250)
			}

			finish(false)
		})()
	})
}

function findNextTokenIndex(config) {
	if (config.tokens.length === 0) {
		return -1
	}

	let currentIdx = config.tokens.findIndex((t) => t.active)
	if (currentIdx < 0) {
		currentIdx = config.tokens.findIndex((t) => t.file === config.current)
	}
	if (currentIdx < 0) {
		return -1
	}

	let nextIdx = (currentIdx + 1) % config.tokens.length
	let attempts = 0

	while (attempts < config.tokens.length - 1) {
		if (
			nextIdx !== currentIdx &&
			existsSync(getVaultPath(config.tokens[nextIdx].file))
		) {
			return nextIdx
		}

		nextIdx = (nextIdx + 1) % config.tokens.length
		attempts++
	}

	return -1
}

function findToken(config, labelOrIdx) {
	const target = String(labelOrIdx).trim()

	// Normalize ALT{N} labels to slot indices
	const altMatch = target.match(/^ALT\s*(\d+)$/i)
	if (altMatch) {
		const altNum = parseInt(altMatch[1], 10)
		const slotIndex = altNum + 1
		return findToken(config, String(slotIndex))
	}

	const numericIdx = parseInt(target, 10)
	if (!Number.isNaN(numericIdx) && String(numericIdx) === target) {
		return config.tokens[numericIdx - 1] || null
	}

	const normalizedTarget = target.toLowerCase()

	return (
		config.tokens.find(
			(t) =>
				t.file.toLowerCase() === normalizedTarget ||
				t.label.toLowerCase() === normalizedTarget ||
				t.label.toLowerCase().includes(normalizedTarget),
		) || null
	)
}

function rotateToNextToken() {
	const config = loadConfig()
	let currentIdx = config.tokens.findIndex((t) => t.active)
	if (currentIdx < 0) {
		currentIdx = config.tokens.findIndex((t) => t.file === config.current)
	}
	if (currentIdx < 0) {
		console.error(
			"[Rotator] No active token found in config; run `bun run token status` and fix token-rotator-config.json",
		)
		return null
	}

	const nextIdx = findNextTokenIndex(config)

	if (nextIdx < 0) {
		return null
	}

	const prevFile = config.tokens[currentIdx].file
	const prevBackup = backupActive(prevFile)
	if (prevBackup) {
		console.log(`[Rotator] Backed up ${prevFile}`)
	}

	const nextFile = config.tokens[nextIdx].file
	const restored = restoreToActive(nextFile)

	if (!restored) {
		console.error(`[Rotator] Failed to restore ${nextFile}`)
		return null
	}

	const prevToken = config.tokens[currentIdx]
	const nextToken = config.tokens[nextIdx]

	config.current = nextFile
	config.tokens.forEach((t, i) => {
		t.active = i === nextIdx
	})
	saveConfig(config)

	return { prev: prevToken, next: nextToken }
}

function switchToToken(labelOrIdx) {
	const config = loadConfig()
	const target = findToken(config, labelOrIdx)

	if (!target) {
		return { error: `Token not found: ${labelOrIdx}` }
	}

	if (!existsSync(getVaultPath(target.file))) {
		return { error: `No vault entry for ${target.file}` }
	}

	let currentIdx = config.tokens.findIndex((t) => t.active)
	if (currentIdx < 0) {
		currentIdx = config.tokens.findIndex((t) => t.file === config.current)
	}
	if (currentIdx >= 0) {
		const prevFile = config.tokens[currentIdx].file
		backupActive(prevFile)
	}

	restoreToActive(target.file)

	config.current = target.file
	config.tokens.forEach((t, i) => {
		t.active = i === config.tokens.indexOf(target)
	})
	saveConfig(config)

	return { success: true, token: target }
}

function getNextVaultFileName(config) {
	const used = new Set(config.tokens.map((t) => t.file))
	if (!used.has("auth.json") && !existsSync(getVaultPath("auth.json"))) {
		return "auth.json"
	}

	let index = 1
	while (true) {
		const candidate = `auth-alt${index}.json`
		if (!used.has(candidate) && !existsSync(getVaultPath(candidate))) {
			return candidate
		}
		index++
	}
}

function addToVault(sourceFile, destFile) {
	const sourcePath = join(AUTH_DIR, sourceFile)
	const vaultPath = getVaultPath(destFile)

	if (!existsSync(sourcePath)) {
		return { error: `Source file not found: ${sourcePath}` }
	}

	copyFileSync(sourcePath, vaultPath)
	console.log(`[Rotator] Added to vault: ${destFile}`)

	const config = loadConfig()
	const existingIdx = config.tokens.findIndex((t) => t.file === destFile)

	if (existingIdx < 0) {
		config.tokens.push({
			file: destFile,
			label: `Account ${config.tokens.length + 1}`,
			active: false,
		})
		saveConfig(config)
	}

	return { success: true }
}

function backupVaultFile(filename, prefix = "manual") {
	const vaultPath = getVaultPath(filename)
	if (!existsSync(vaultPath)) {
		return null
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const backupName = `${prefix}-${timestamp}-${filename}`
	copyFileSync(vaultPath, getBackupPath(backupName))
	pruneBackups()
	return backupName
}

function overwriteVaultSlot(slotNumber, sourcePath) {
	const config = loadConfig()
	const slotIndex = Number.parseInt(String(slotNumber).trim(), 10) - 1
	const token = config.tokens[slotIndex]

	if (!token) {
		return { error: `Token slot not found: ${slotNumber}` }
	}

	backupVaultFile(token.file)
	copyFileSync(sourcePath, getVaultPath(token.file))
	return { success: true, token, slotIndex }
}

function addAuthFileAsNewVaultSlot(sourcePath) {
	const config = loadConfig()
	const destFile = getNextVaultFileName(config)
	copyFileSync(sourcePath, getVaultPath(destFile))

	const token = {
		file: destFile,
		label: `Account ${config.tokens.length + 1}`,
		active: false,
	}
	config.tokens.push(token)
	saveConfig(config)

	return { success: true, token, slotIndex: config.tokens.length - 1 }
}

function deleteVaultSlot(slotNumber) {
	const config = loadConfig()
	const slotIndex = Number.parseInt(String(slotNumber).trim(), 10) - 1
	const token = config.tokens[slotIndex]

	if (!token) {
		return { error: `Token slot not found: ${slotNumber}` }
	}

	if (token.active || token.file === config.current) {
		return { error: "Cannot delete the active slot. Switch first." }
	}

	backupVaultFile(token.file)
	const vaultPath = getVaultPath(token.file)
	if (existsSync(vaultPath)) {
		unlinkSync(vaultPath)
	}

	config.tokens.splice(slotIndex, 1)
	saveConfig(config)
	return { success: true, token }
}

async function stopProxy() {
	const SERVICE_NAME = "OpenAIOAuthProxy"
	const PORT = DEFAULT_PORT
	const proxyPath = REPO_ROOT
	const pidFile = join(proxyPath, ".codex", "proxy.pid")

	if (process.platform === "win32") {
		try {
			invokeWindowsService("stop", "", [
				"-ServiceName",
				SERVICE_NAME,
				"-Port",
				String(PORT),
			])
			return true
		} catch (e) {
			console.error("[Rotator] Failed to stop service:", e.message)
			return false
		}
	} else {
		// Unix: use PID file + port fallback
		try {
			if (existsSync(pidFile)) {
				const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10)
				if (!Number.isNaN(pid) && pid > 0) {
					try {
						execSync(`kill -15 ${pid}`, { stdio: "ignore" })
						console.log(`[Rotator] Stopped proxy PID ${pid}`)
					} catch {}
					await sleep(1000)
				}
			}
		} catch {}

		try {
			for (const pid of getPortProcessIds()) {
				execSync(`kill -9 ${pid}`, { stdio: "ignore" })
				console.log(`[Rotator] Killed lingering proxy PID ${pid}`)
			}
		} catch {}

		const remainingPids = getPortProcessIds()
		if (remainingPids.length > 0) {
			console.error(
				`[Rotator] Stop failed: port ${DEFAULT_PORT} still owned by PID(s) ${remainingPids.join(", ")}`,
			)
			return false
		}
	}

	try {
		if (existsSync(pidFile)) {
			unlinkSync(pidFile)
		}
	} catch {}

	return true
}

async function startProxy() {
	const SERVICE_NAME = "OpenAIOAuthProxy"
	const PORT = DEFAULT_PORT

	if (process.platform === "win32") {
		console.log("[Rotator] Starting service via PowerShell...")
		try {
			invokeWindowsService("start", "", [
				"-ServiceName",
				SERVICE_NAME,
				"-Port",
				String(PORT),
				"-HealthUrl",
				HEALTH_URL,
			])
			console.log("[Rotator] Service start complete")
			return true
		} catch (e) {
			console.error("[Rotator] Failed to start service:", e.message)
			return false
		}
	} else {
		// Unix: spawn the proxy package dev command directly.
		console.log("[Rotator] Starting proxy...")
		try {
			const proxyPath = join(REPO_ROOT, "packages", "openai-oauth")
			const pidFile = join(REPO_ROOT, ".codex", "proxy.pid")
			mkdirSync(dirname(pidFile), { recursive: true })
			const child = spawn(process.argv[0], ["run", "dev"], {
				cwd: proxyPath,
				detached: true,
				stdio: "ignore",
			})

			writeFileSync(pidFile, String(child.pid))

			const started = await waitForProxyStart(child)
			if (!started) {
				try {
					execSync(`kill -9 ${child.pid}`, { stdio: "ignore" })
				} catch {}

				try {
					if (existsSync(pidFile)) {
						unlinkSync(pidFile)
					}
				} catch {}

				console.error("[Rotator] Start failed: proxy did not become healthy")
				return false
			}

			child.unref()
		} catch (e) {
			console.error("[Rotator] Start failed:", e.message)
			return false
		}
		return true
	}
}

async function restartProxy() {
	if (!(await stopProxy())) {
		return false
	}
	return startProxy()
}

function invokeWindowsService(action, target = "", extraArgs = []) {
	const psScript = join(__dirname, "rotate-service-token.ps1")
	const args = [
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		psScript,
		"-Action",
		action,
	]
	if (target) {
		args.push("-Target", String(target))
	}
	args.push(...extraArgs)
	execFileSync("powershell", args, { stdio: "inherit" })
}

function runTokenCommand(args) {
	try {
		execFileSync("bun", [SCRIPT_FILE, ...args], { stdio: "inherit" })
		return true
	} catch (error) {
		console.error(
			`[Rotator] Command failed: bun ${SCRIPT_FILE} ${args.join(" ")}`,
		)
		if (
			error &&
			typeof error === "object" &&
			"status" in error &&
			error.status !== undefined
		) {
			console.error(`[Rotator] Exit code: ${error.status}`)
		}
		return false
	}
}

async function askMenuQuestion(rl, question) {
	return (await rl.question(question)).trim()
}

function runCodexLogin(tempAuthDir) {
	const previousCodexHome = process.env.CODEX_HOME
	process.env.CODEX_HOME = tempAuthDir

	try {
		execFileSync("npx", ["@openai/codex", "login"], {
			cwd: REPO_ROOT,
			stdio: "inherit",
			env: { ...process.env, CODEX_HOME: tempAuthDir },
		})
	} finally {
		if (previousCodexHome === undefined) {
			delete process.env.CODEX_HOME
		} else {
			process.env.CODEX_HOME = previousCodexHome
		}
	}
}

async function pauseMenu(rl) {
	await askMenuQuestion(rl, "Press Enter to continue...")
}

async function addNewTokenFlow(rl) {
	console.log("\n[Rotator] Starting Codex login in a temporary CODEX_HOME.")
	console.log("[Rotator] Your live auth.json will not be overwritten by login.")

	const tempAuthDir = mkdtempSync(join(tmpdir(), "openai-oauth-codex-"))
	try {
		try {
			runCodexLogin(tempAuthDir)
		} catch (error) {
			console.error("[Rotator] Codex login failed or was cancelled")
			if (error instanceof Error && error.message) {
				console.error(`[Rotator] ${error.message}`)
			}
			return
		}

		const tempAuthPath = join(tempAuthDir, "auth.json")
		if (!existsSync(tempAuthPath)) {
			console.error(`[Rotator] Login did not create ${tempAuthPath}`)
			return
		}

		console.log(`
New token options:
1. Replace current active token now (recommended)
2. Overwrite an existing vault slot
3. Add as a new vault slot
0. Cancel
`)
		const choice = (await askMenuQuestion(rl, "Select option [1]: ")) || "1"

		switch (choice) {
			case "1": {
				const config = loadConfig()
				let activeIndex = config.tokens.findIndex((token) => token.active)
				if (activeIndex < 0) {
					activeIndex = config.tokens.findIndex(
						(token) => token.file === config.current,
					)
				}
				if (activeIndex < 0) {
					console.error("[Rotator] No active token slot found")
					break
				}
				const result = overwriteVaultSlot(activeIndex + 1, tempAuthPath)
				if (result.error) {
					console.error(`[Rotator] ${result.error}`)
					break
				}
				console.log("[Rotator] Active slot was updated. Re-applying it...")
				runTokenCommand(["switch", String(activeIndex + 1)])
				break
			}
			case "2": {
				showTokenSlots()
				const slot = await askMenuQuestion(
					rl,
					"Select slot number to overwrite (blank to cancel): ",
				)
				if (!slot) {
					console.log("[Rotator] Cancelled")
					break
				}
				const result = overwriteVaultSlot(slot, tempAuthPath)
				if (result.error) {
					console.error(`[Rotator] ${result.error}`)
					break
				}
				console.log(`[Rotator] Overwrote ${result.token.label}`)
				if (result.token.active) {
					console.log("[Rotator] Active slot was updated. Re-applying it...")
					runTokenCommand(["switch", String(result.slotIndex + 1)])
				}
				break
			}
			case "3": {
				const result = addAuthFileAsNewVaultSlot(tempAuthPath)
				console.log(
					`[Rotator] Added ${result.token.label} (${result.token.file})`,
				)
				const switchNow = await askMenuQuestion(
					rl,
					"Switch to this new token now? [y/N]: ",
				)
				if (/^y(es)?$/i.test(switchNow)) {
					runTokenCommand(["switch", String(result.slotIndex + 1)])
				}
				break
			}
			case "0":
				console.log("[Rotator] Cancelled. Temporary token discarded.")
				break
			default:
				console.error("[Rotator] Unknown option")
		}
	} finally {
		rmSync(tempAuthDir, { recursive: true, force: true })
	}
}

async function deleteTokenFlow(rl) {
	showTokenSlots()
	const slot = await askMenuQuestion(
		rl,
		"Select slot number to delete (blank to cancel): ",
	)
	if (!slot) {
		console.log("[Rotator] Cancelled")
		return
	}

	const config = loadConfig()
	const token = config.tokens[Number.parseInt(slot, 10) - 1]
	if (!token) {
		console.error(`[Rotator] Token slot not found: ${slot}`)
		return
	}

	const confirmation = await askMenuQuestion(
		rl,
		`Delete ${token.label} (${token.file})? [y/N]: `,
	)
	if (!/^y(es)?$/i.test(confirmation)) {
		console.log("[Rotator] Delete cancelled")
		return
	}

	const result = deleteVaultSlot(slot)
	if (result.error) {
		console.error(`[Rotator] ${result.error}`)
		return
	}

	console.log(`[Rotator] Deleted ${result.token.label}`)
}

async function runInteractiveMenu() {
	const rl = createInterface({ input, output })

	try {
		while (true) {
			console.log(`
=== Token Manager ===

1. Show token slots
2. Create/import a new token
3. Switch active token now
4. Rotate to next token now
5. Delete a token slot
6. Show proxy/server status
7. Start proxy/server
8. Restart proxy/server
9. Stop proxy/server
H. Show help
0. Exit
`)

			const choice = await askMenuQuestion(rl, "Select option: ")

			switch (choice) {
				case "1":
					showTokenSlots()
					await pauseMenu(rl)
					break
				case "2":
					await addNewTokenFlow(rl)
					await pauseMenu(rl)
					break
				case "3": {
					showTokenSlots()
					const slot = await askMenuQuestion(rl, "Token slot number: ")
					if (!slot) {
						console.error("[Rotator] Token slot is required")
						break
					}
					runTokenCommand(["switch", slot])
					await pauseMenu(rl)
					break
				}
				case "4":
					runTokenCommand(["rotate"])
					await pauseMenu(rl)
					break
				case "5":
					await deleteTokenFlow(rl)
					await pauseMenu(rl)
					break
				case "6":
					runTokenCommand(["status"])
					await pauseMenu(rl)
					break
				case "7":
					runTokenCommand(["start"])
					await pauseMenu(rl)
					break
				case "8":
					runTokenCommand(["restart"])
					await pauseMenu(rl)
					break
				case "9":
					runTokenCommand(["stop"])
					await pauseMenu(rl)
					break
				case "h":
				case "H":
					showHelp()
					await pauseMenu(rl)
					break
				case "0":
				case "q":
				case "Q":
					return
				default:
					console.error("[Rotator] Unknown option")
			}
		}
	} finally {
		rl.close()
	}
}

function normalizeArgs(args) {
	const [command, ...rest] = args
	if (!command || command.startsWith("--")) {
		return { args, commandStyle: false, command: command || "" }
	}

	switch (command) {
		case "menu":
			return { args: ["--menu", ...rest], commandStyle: true, command }
		case "status":
			return { args: ["--status", ...rest], commandStyle: true, command }
		case "rotate":
			return { args: ["--rotate", ...rest], commandStyle: true, command }
		case "switch":
		case "use":
			return { args: ["--use", ...rest], commandStyle: true, command: "switch" }
		case "restart":
			return { args: ["--restart", ...rest], commandStyle: true, command }
		case "stop":
			return { args: ["--stop", ...rest], commandStyle: true, command }
		case "start":
			return { args: ["--start", ...rest], commandStyle: true, command }
		case "preview-next":
			return { args: ["--preview-next", ...rest], commandStyle: true, command }
		case "vault":
			return { args: ["--vault", ...rest], commandStyle: true, command }
		default:
			return { args, commandStyle: true, command }
	}
}

function showHelp() {
	console.log(`
=== Token Rotator (Vault System) ===

Usage:
  bun run token                   Open interactive token manager menu
  bun run token menu              Open interactive token manager menu
  bun run token status              Show token and runtime status
  bun run token rotate              Rotate to next token and restart proxy
  bun run token switch <n>          Switch to Account N and restart proxy
  bun run token restart             Restart proxy
  bun run token stop                Stop proxy
  bun run token start               Start proxy
  bun run token preview-next        Preview next token on Windows
  bun run token vault add           Add auth.json to vault

Legacy flags:
  bun token-rotator.js --status        Show current token
  bun token-rotator.js --rotate       Rotate to next token
  bun token-rotator.js --use <n>     Switch to Account N
  bun token-rotator.js --rotate --no-restart  Rotate without restarting proxy
  bun token-rotator.js --use <n> --no-restart Switch without restarting proxy
  bun token-rotator.js --vault add    Add auth.json to vault

System:
  vault/     - Original tokens (never modified)
  active/    - Working copy (from vault)
  backups/   - Rotation backups

Workflow:
  1. Get new token: npx @openai/codex login
  2. Add to vault: bun token-rotator.js --vault add
  3. Switch: bun token-rotator.js --use 3
`)
}

async function main() {
	const normalized = normalizeArgs(process.argv.slice(2))
	const args = normalized.args
	ensureDirs()
	const skipRestart = args.includes("--no-restart")

	if (args.length === 0 || args.includes("--menu")) {
		await runInteractiveMenu()
		process.exit(0)
	}

	if (args.includes("--status")) {
		if (process.platform === "win32" && normalized.commandStyle) {
			invokeWindowsService("status")
		} else {
			await showRuntimeStatus()
		}
		process.exit(0)
	}

	if (args.includes("--preview-next")) {
		if (process.platform !== "win32") {
			console.error(
				"[Rotator] preview-next is only implemented for Windows service flow",
			)
			process.exit(1)
		}
		invokeWindowsService("preview-next")
		process.exit(0)
	}

	if (args.includes("--stop")) {
		if (!(await stopProxy())) {
			process.exit(1)
		}
		process.exit(0)
	}

	if (args.includes("--start")) {
		if (!(await startProxy())) {
			process.exit(1)
		}
		process.exit(0)
	}

	if (args.includes("--restart")) {
		if (!(await restartProxy())) {
			process.exit(1)
		}
		process.exit(0)
	}

	if (args.includes("--rotate")) {
		const config = loadConfig()
		if (findNextTokenIndex(config) < 0) {
			console.log("\n❌ All tokens exhausted!")
			process.exit(1)
		}

		if (process.platform === "win32" && !skipRestart) {
			invokeWindowsService("rotate")
			process.exit(0)
		}

		if (!skipRestart) {
			if (!(await stopProxy())) {
				process.exit(1)
			}
		}
		const result = rotateToNextToken()
		if (!result) {
			console.log("\n❌ All tokens exhausted!")
			process.exit(1)
		}
		console.log(
			`[Rotator] Switched: ${result.prev.label} → ${result.next.label}`,
		)
		if (skipRestart) {
			console.log("[Rotator] Restart skipped (--no-restart)")
		} else if (!(await startProxy())) {
			process.exit(1)
		}
		process.exit(0)
	}

	if (args.includes("--use")) {
		const target = args[args.indexOf("--use") + 1]
		if (!target) {
			console.error("Usage: --use <n>")
			process.exit(1)
		}

		const config = loadConfig()
		const token = findToken(config, target)
		if (!token) {
			console.error(`[Rotator] Token not found: ${target}`)
			process.exit(1)
		}
		if (!existsSync(getVaultPath(token.file))) {
			console.error(`[Rotator] No vault entry for ${token.file}`)
			process.exit(1)
		}

		if (process.platform === "win32" && !skipRestart) {
			invokeWindowsService("switch", target)
			process.exit(0)
		}

		if (!skipRestart) {
			if (!(await stopProxy())) {
				process.exit(1)
			}
		}
		const result = switchToToken(target)
		if (result.error) {
			console.error(`[Rotator] ${result.error}`)
			process.exit(1)
		}
		console.log(`[Rotator] Switched to: ${result.token.label}`)
		if (skipRestart) {
			console.log("[Rotator] Restart skipped (--no-restart)")
		} else if (!(await startProxy())) {
			process.exit(1)
		}
		process.exit(0)
	}

	if (args.includes("--vault")) {
		const action = args[args.indexOf("--vault") + 1]
		if (action === "add") {
			const source = "auth.json"
			const config = loadConfig()
			const dest = getNextVaultFileName(config)
			const result = addToVault(source, dest)
			if (result.error) {
				console.error(`[Rotator] ${result.error}`)
				process.exit(1)
			}
			console.log(`[Rotator] ${dest} ready to use`)
		}
		process.exit(0)
	}

	showHelp()
}

await main()
