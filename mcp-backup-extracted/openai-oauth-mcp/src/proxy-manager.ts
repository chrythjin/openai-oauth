import { spawn, type ChildProcessByStdio } from "node:child_process"
import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

export const PROXY_HOST = "127.0.0.1"
export const PROXY_PORT = 10531

const PROXY_START_TIMEOUT_MS = 15_000
const PROXY_STOP_TIMEOUT_MS = 5_000
const PROXY_REQUEST_TIMEOUT_MS = 10_000
const LOG_HISTORY_LIMIT = 200
const HEALTH_PATH = "/health"
const AUTH_FILENAME = "auth.json"
const LOCK_DIRNAME = ".openai-oauth-mcp-sessions"
const MODULE_DIRNAME = path.dirname(fileURLToPath(import.meta.url))
// Allow overriding via environment variable for global installs
const PROXY_WORKDIR =
	process.env.OPENAI_OAUTH_MCP_WORKDIR ||
	path.resolve(MODULE_DIRNAME, "../../openai-oauth")

type JsonPrimitive = string | number | boolean | null
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type AuthDiscoveryResult = {
	hasAuth: boolean
	authFilePath?: string
	candidates: string[]
}

export type ProxyStatusResult = {
	running: boolean
	port: number
	hasAuth: boolean
}

type ProxyRequestOptions = {
	path: string
	method?: string
	headers?: Record<string, string>
	body?: string
	timeoutMs?: number
}

type ProxyResponse = {
	statusCode: number
	headers: http.IncomingHttpHeaders
	bodyText: string
	bodyJson?: unknown
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms)
	})

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const resolveAuthFileCandidates = (): string[] => {
	const chatgptLocalHome = process.env.CHATGPT_LOCAL_HOME
	const codexHome = process.env.CODEX_HOME

	return [
		chatgptLocalHome ? path.join(chatgptLocalHome, AUTH_FILENAME) : undefined,
		codexHome ? path.join(codexHome, AUTH_FILENAME) : undefined,
		path.join(os.homedir(), ".chatgpt-local", AUTH_FILENAME),
		path.join(os.homedir(), ".codex", AUTH_FILENAME),
	].filter((candidate): candidate is string => typeof candidate === "string")
}

const formatChildLogLine = (
	stream: "stdout" | "stderr",
	chunk: Buffer,
): string => {
	const text = chunk.toString("utf-8").trim()
	return text.length > 0 ? `[${stream}] ${text}` : ""
}

const toErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

type ManagedProxyChild = ChildProcessByStdio<null, Readable, Readable>

// --- Lease directory for multi-session reference counting ---
// Instead of a single JSON file (race-prone read-modify-write), each session
// creates one lease file atomically. Only the last session to release stops the proxy.

type LeaseEntry = {
	pid: number
	acquiredAt: number // unix ms timestamp
}

const isSafePid = (pid: unknown): pid is number =>
	typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0

const getLeaseDir = (): string =>
	process.env.OPENAI_OAUTH_MCP_LOCKDIR || path.join(PROXY_WORKDIR, LOCK_DIRNAME)

/**
 * Returns true when we can confirm the process is NOT running.
 * Returns false when we can't determine (treat as alive = safe).
 */
const isPidDead = (pid: number): boolean => {
	try {
		process.kill(pid, 0)
		// Signal 0 only checks existence. If we get here, process exists.
		return false
	} catch (err) {
		if (err instanceof Error) {
			const code = (err as NodeJS.ErrnoException).code
			// ESRCH = no such process → dead
			// EPERM = access denied = process exists but inaccessible → treat as alive
			if (code === "ESRCH") return true
		}
		// Everything else (EPERM, unknown) → treat as alive (safe)
		return false
	}
}

const isEnoent = (err: unknown): boolean =>
	err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT"

/**
 * List all active leases: read every file in the lease dir, filter dead PIDs.
 */
const listActiveLeases = async (): Promise<LeaseEntry[]> => {
	try {
		const dir = getLeaseDir()
		const filenames = await readdir(dir)
		const results: LeaseEntry[] = []

		for (const filename of filenames) {
			try {
				const filePath = path.join(dir, filename)
				const content = await readFile(filePath, "utf-8")
				const parsed = JSON.parse(content) as unknown
				if (
					isRecord(parsed) &&
					isSafePid(parsed.pid) &&
					typeof parsed.acquiredAt === "number"
				) {
					results.push({ pid: parsed.pid, acquiredAt: parsed.acquiredAt })
				}
			} catch {
				// Malformed file → skip
			}
		}

		// Remove entries whose process is gone
		const alive = results.filter((r) => !isPidDead(r.pid))
		return alive
	} catch {
		return []
	}
}

/**
 * Try to acquire a lease for this session. Idempotent — safe to call multiple times.
 * Returns true if this session now holds a lease.
 */
const acquireLease = async (): Promise<boolean> => {
	try {
		const dir = getLeaseDir()
		// Ensure the lease directory exists (handles read-only PROXY_WORKDIR gracefully)
		await mkdir(dir, { recursive: true })

		const sessionId =
			process.env.OPENAI_OAUTH_MCP_SESSION_ID || String(process.pid)
		const filePath = path.join(dir, sessionId)
		const entry: LeaseEntry = { pid: process.pid, acquiredAt: Date.now() }

		// Atomic create — fails if file already exists (another session claimed same ID)
		await writeFile(filePath, JSON.stringify(entry), {
			encoding: "utf-8",
			flag: "wx",
		})
		return true
	} catch (err) {
		if (isEnoent(err)) {
			// Directory was deleted between mkdir and write — retry once
			try {
				const dir = getLeaseDir()
				await mkdir(dir, { recursive: true })
				const sessionId =
					process.env.OPENAI_OAUTH_MCP_SESSION_ID || String(process.pid)
				const filePath = path.join(dir, sessionId)
				const entry: LeaseEntry = { pid: process.pid, acquiredAt: Date.now() }
				await writeFile(filePath, JSON.stringify(entry), {
					encoding: "utf-8",
					flag: "wx",
				})
				return true
			} catch {
				return false
			}
		}
		// File already exists (duplicate acquire) → treat as success (already have lease)
		return true
	}
}

/**
 * Release this session's lease. Idempotent.
 * Returns true if this session had a lease and removed it.
 */
const releaseLease = async (): Promise<boolean> => {
	try {
		const sessionId =
			process.env.OPENAI_OAUTH_MCP_SESSION_ID || String(process.pid)
		const filePath = path.join(getLeaseDir(), sessionId)
		await unlink(filePath)
		return true
	} catch (err) {
		if (isEnoent(err)) return false // Didn't have a lease
		return false
	}
}

/**
 * Returns true when no other alive leases remain (i.e., this session is the last owner).
 */
const isLastOwner = async (): Promise<boolean> => {
	const leases = await listActiveLeases()
	// "this session" may not have been added yet, or may have been removed already
	// Count leases that belong to OTHER PIDs
	const others = leases.filter((r) => r.pid !== process.pid)
	return others.length === 0
}

export class ProxyManager {
	private child: ManagedProxyChild | undefined
	private readonly logHistory: string[] = []
	private startPromise: Promise<{ status: "running"; port: number }> | undefined
	private _acquired = false

	/**
	 * Idempotent acquire: register this session's lease, then ensure the proxy is running.
	 * Safe to call multiple times — subsequent calls after the first are no-ops.
	 */
	async acquire(): Promise<{ status: "running"; port: number }> {
		if (!this._acquired) {
			await acquireLease()
			this._acquired = true
		}
		return this.start()
	}

	/**
	 * Idempotent release: remove this session's lease.
	 * Only stops the proxy if this session was the last owner.
	 */
	async release(): Promise<{ status: "stopped" | "released" }> {
		if (!this._acquired) return { status: "released" }

		const hadLease = await releaseLease()
		this._acquired = false

		if (hadLease) {
			const last = await isLastOwner()
			if (last) {
				await this.stop()
				return { status: "stopped" }
			}
		}
		return { status: "released" }
	}

	async start(): Promise<{ status: "running"; port: number }> {
		// Check if proxy is already running externally before even creating a startPromise
		if (await this.isProxyHealthy()) {
			return { status: "running", port: PROXY_PORT }
		}

		if (this.startPromise) {
			return this.startPromise
		}

		this.startPromise = this.startInternal().finally(() => {
			this.startPromise = undefined
		})

		return this.startPromise
	}

	/**
	 * Stop this manager's child process.
	 * Checks lock state — only kills if this instance owns the proxy or no other
	 * sessions are active.
	 */
	async stop(): Promise<{ status: "stopped" }> {
		const child = this.child
		if (!child || child.exitCode !== null) {
			this.child = undefined
			return { status: "stopped" }
		}

		// Attempt graceful SIGTERM first; escalate to SIGKILL only if needed
		try {
			const termSent = child.kill("SIGTERM")
			if (termSent) {
				// Wait up to PROXY_STOP_TIMEOUT_MS for graceful exit
				try {
					await this.waitForExit(child, PROXY_STOP_TIMEOUT_MS)
					return { status: "stopped" }
				} catch {
					// Timed out → SIGTERM didn't work, escalate
				}
			}
		} catch {
			// kill() failed (e.g., process already dead) — proceed to SIGKILL
		}

		// Escalate to SIGKILL
		try {
			child.kill("SIGKILL")
			await this.waitForExit(child, PROXY_STOP_TIMEOUT_MS).catch(
				() => undefined,
			)
		} catch {
			// Already dead
		}

		this.child = undefined
		return { status: "stopped" }
	}

	async status(): Promise<ProxyStatusResult> {
		const auth = await this.findAuthFile()
		const running =
			this.isManagedChildRunning() || (await this.isProxyHealthy())
		return {
			running,
			port: PROXY_PORT,
			hasAuth: auth.hasAuth,
		}
	}

	async chatCompletion(requestBody: JsonObject): Promise<JsonObject> {
		// Auto-start proxy if not running (acquire handles lease + start atomically)
		const status = await this.status()
		if (!status.running) {
			try {
				await this.acquire()
			} catch (startError) {
				throw new Error(
					`Failed to start proxy: ${startError instanceof Error ? startError.message : String(startError)}`,
				)
			}
		}

		const response = await this.requestProxy({
			path: "/v1/chat/completions",
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(requestBody),
		})

		if (response.statusCode < 200 || response.statusCode >= 300) {
			const detail =
				response.bodyText.length > 0
					? response.bodyText
					: `Proxy request failed with status ${response.statusCode}.`
			throw new Error(detail)
		}

		if (!isRecord(response.bodyJson)) {
			throw new Error("Proxy returned a non-object chat completion response.")
		}

		return response.bodyJson as JsonObject
	}

	async findAuthFile(): Promise<AuthDiscoveryResult> {
		const candidates = resolveAuthFileCandidates()

		for (const candidate of candidates) {
			try {
				await access(candidate)
				return {
					hasAuth: true,
					authFilePath: candidate,
					candidates,
				}
			} catch {}
		}

		return {
			hasAuth: false,
			candidates,
		}
	}

	private async startInternal(): Promise<{ status: "running"; port: number }> {
		// Clean up stale leases from dead processes before starting
		const alive = await listActiveLeases()
		if (alive.length > 0) {
			// Other sessions hold leases — proxy is already managed; don't re-spawn
			if (await this.isProxyHealthy()) {
				return { status: "running", port: PROXY_PORT }
			}
			// Proxy is unhealthy but others hold leases — let them restart it
		}

		const auth = await this.findAuthFile()
		if (!auth.hasAuth) {
			throw new Error(
				[
					"No auth file was found in the default search paths.",
					...auth.candidates.map((candidate) => `- ${candidate}`),
					"Run `npx @openai/codex login` and try again.",
				].join("\n"),
			)
		}

		if (this.isManagedChildRunning() || (await this.isProxyHealthy())) {
			return { status: "running", port: PROXY_PORT }
		}

		this.logHistory.length = 0 // Clear stale logs before new start attempt

		const child = spawn("bun", ["run", "dev"], {
			cwd: PROXY_WORKDIR,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		})

		this.child = child
		this.attachChildListeners(child)

		try {
			// Race: waitForHealthy vs child error/exit for fast fail
			await Promise.race([
				this.waitForHealthy(child, PROXY_START_TIMEOUT_MS),
				this.waitForChildError(child),
			])
			return { status: "running", port: PROXY_PORT }
		} catch (error) {
			if (child.exitCode === null) {
				child.kill("SIGKILL")
				await this.waitForExit(child, PROXY_STOP_TIMEOUT_MS).catch(
					() => undefined,
				)
			}

			throw new Error(this.buildStartupErrorMessage(error))
		}
	}

	private attachChildListeners(child: ManagedProxyChild): void {
		child.stdout.on("data", (chunk: Buffer) => {
			this.recordLog("stdout", chunk)
		})

		child.stderr.on("data", (chunk: Buffer) => {
			this.recordLog("stderr", chunk)
		})

		child.on("error", (error) => {
			this.recordRawLog(`[process] ${toErrorMessage(error)}`)
		})

		child.on("exit", (code, signal) => {
			this.recordRawLog(
				`[process] exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}`,
			)

			if (this.child === child) {
				this.child = undefined
			}
		})
	}

	private recordLog(stream: "stdout" | "stderr", chunk: Buffer): void {
		const line = formatChildLogLine(stream, chunk)
		if (line.length > 0) {
			this.recordRawLog(line)
		}
	}

	private recordRawLog(line: string): void {
		this.logHistory.push(line)
		if (this.logHistory.length > LOG_HISTORY_LIMIT) {
			this.logHistory.splice(0, this.logHistory.length - LOG_HISTORY_LIMIT)
		}
	}

	private isManagedChildRunning(): boolean {
		return this.child != null && this.child.exitCode === null
	}

	private async waitForHealthy(
		child: ManagedProxyChild,
		timeoutMs: number,
	): Promise<void> {
		const startedAt = Date.now()

		while (Date.now() - startedAt < timeoutMs) {
			if (child.exitCode !== null) {
				throw new Error(
					`Proxy process exited before it became healthy (exit code ${child.exitCode}).`,
				)
			}

			if (await this.isProxyHealthy()) {
				return
			}

			await sleep(250)
		}

		throw new Error(
			`Timed out waiting for the proxy to become healthy on port ${PROXY_PORT}.`,
		)
	}

	/** Rejects immediately when the child emits an 'error' event. */
	private waitForChildError(child: ManagedProxyChild): Promise<never> {
		return new Promise((_, reject) => {
			const handler = (err: Error) => {
				child.off("error", handler)
				child.off("exit", exitHandler)
				reject(err)
			}
			const exitHandler = (code: number | null, signal: string | null) => {
				child.off("error", handler)
				child.off("exit", exitHandler)
				reject(
					new Error(
						`Proxy process exited early with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}.`,
					),
				)
			}
			child.on("error", handler)
			child.on("exit", exitHandler)
		})
	}

	private async waitForExit(
		child: ManagedProxyChild,
		timeoutMs: number,
	): Promise<void> {
		if (child.exitCode !== null) {
			if (this.child === child) {
				this.child = undefined
			}
			return
		}

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup()
				reject(
					new Error("Timed out while waiting for the proxy process to stop."),
				)
			}, timeoutMs)

			const cleanup = () => {
				clearTimeout(timeout)
				child.off("exit", handleExit)
			}

			const handleExit = () => {
				cleanup()
				resolve()
			}

			child.once("exit", handleExit)
		})

		if (this.child === child) {
			this.child = undefined
		}
	}

	private async isProxyHealthy(): Promise<boolean> {
		try {
			const response = await this.requestProxy({
				path: HEALTH_PATH,
				method: "GET",
				timeoutMs: 1_500,
			})

			if (response.statusCode !== 200) {
				return false
			}

			return (
				isRecord(response.bodyJson) &&
				response.bodyJson.ok === true &&
				response.bodyJson.replay_state === "stateless"
			)
		} catch {
			return false
		}
	}

	private async requestProxy(
		options: ProxyRequestOptions,
	): Promise<ProxyResponse> {
		return new Promise<ProxyResponse>((resolve, reject) => {
			const request = http.request(
				{
					host: PROXY_HOST,
					port: PROXY_PORT,
					path: options.path,
					method: options.method ?? "GET",
					headers: options.body
						? {
								"content-length": Buffer.byteLength(options.body).toString(),
								...options.headers,
							}
						: options.headers,
				},
				(response) => {
					const chunks: Buffer[] = []
					response.on("data", (chunk: Buffer) => {
						chunks.push(Buffer.from(chunk))
					})

					response.on("end", () => {
						const bodyText = Buffer.concat(chunks).toString("utf-8")
						let bodyJson: unknown

						if (bodyText.length > 0) {
							try {
								bodyJson = JSON.parse(bodyText)
							} catch {}
						}

						resolve({
							statusCode: response.statusCode ?? 500,
							headers: response.headers,
							bodyText,
							bodyJson,
						})
					})
				},
			)

			request.setTimeout(options.timeoutMs ?? PROXY_REQUEST_TIMEOUT_MS, () => {
				request.destroy(new Error("Proxy request timed out."))
			})

			request.on("error", reject)

			if (options.body) {
				request.write(options.body)
			}

			request.end()
		})
	}

	private buildStartupErrorMessage(error: unknown): string {
		const lines = [toErrorMessage(error)]
		const recentLogs = this.logHistory.slice(-20)

		if (recentLogs.length > 0) {
			lines.push("Recent proxy logs:")
			lines.push(...recentLogs)
		}

		return lines.join("\n")
	}
}
