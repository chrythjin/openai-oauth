import { join } from "node:path"
import { requireDashboardOrigin } from "./dashboard-security.js"
import { toErrorResponse, toJsonResponse } from "./shared.js"
import {
	addTokenToVault,
	deleteTokenSlot,
	listTokenSlots,
	rotateToken,
	switchToken,
	type TokenSlotInfo,
	type TokenSwitchResult,
	type VaultPaths,
} from "./vault-ops.js"

// ── Types ──────────────────────────────────────────────────────

type SwitchRequestBody = {
	slot?: number | string
}

type AddRequestBody = {
	sourcePath?: string
}

type RedactedSlot = {
	slot: number
	label: string
	active: boolean
	inVault: boolean
	expiry: string | null
}

type VaultSuccessResult = { success: true; result: TokenSwitchResult }

// ── Helpers ────────────────────────────────────────────────────

const toRedactedSlot = (slot: TokenSlotInfo): RedactedSlot => ({
	slot: slot.slot,
	label: slot.label,
	active: slot.active,
	inVault: slot.inVault,
	expiry: slot.expiry,
})

// Convert raw TokenSlot (from switch/rotate result) to RedactedSlot by
// looking up the full TokenSlotInfo from the current vault listing.
const toRedactedSlotFromToken = (
	token: { file: string; label: string; active: boolean },
	allSlots: TokenSlotInfo[],
): RedactedSlot => {
	const found = allSlots.find((s) => s.label === token.label)
	if (found) return toRedactedSlot(found)
	// label not found — fall back to position-based slot
	const idx = allSlots.findIndex((s) => s.label === token.label)
	return {
		slot: idx >= 0 ? idx + 1 : 0,
		label: token.label,
		active: token.active,
		inVault: false,
		expiry: null,
	}
}

const normalizeOpResult = (
	result: VaultSuccessResult,
	allSlots: TokenSlotInfo[],
	restartRequired = false,
): Response => {
	const { prev, next } = result.result
	return toJsonResponse({
		success: true,
		prev: toRedactedSlotFromToken(prev, allSlots),
		next: toRedactedSlotFromToken(next, allSlots),
		restart_required: restartRequired,
	})
}

const readJsonBody = async <T extends Record<string, unknown>>(
	request: Request,
): Promise<T | null> => {
	try {
		const text = await request.text()
		if (!text.trim()) return null
		const parsed = JSON.parse(text)
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as T)
			: null
	} catch {
		return null
	}
}

const toTokenApiResponse = (response: Response): Response => {
	response.headers.delete("access-control-allow-origin")
	response.headers.delete("access-control-allow-methods")
	response.headers.delete("access-control-allow-headers")
	return response
}

const extractSlotNumber = (pathname: string): number | null => {
	const match = pathname.match(/^\/api\/tokens\/slots\/(\d+)$/)
	if (!match?.[1]) return null
	const slot = Number.parseInt(match[1], 10)
	return Number.isInteger(slot) && slot > 0 ? slot : null
}

// ── Handler ────────────────────────────────────────────────────

export async function handleTokenApiRequest(
	request: Request,
	paths: VaultPaths,
): Promise<Response> {
	const url = new URL(request.url)
	const { pathname } = url

	if (request.method === "POST" || request.method === "DELETE") {
		const originResponse = requireDashboardOrigin(request)
		if (originResponse) return originResponse
	}

	// GET /api/tokens/slots — list all slots (no auth required, but no wildcard CORS)
	if (request.method === "GET" && pathname === "/api/tokens/slots") {
		return toTokenApiResponse(
			toJsonResponse({
				slots: listTokenSlots(paths).map(toRedactedSlot),
			}),
		)
	}

	// POST /api/tokens/switch — switch active token slot
	if (request.method === "POST" && pathname === "/api/tokens/switch") {
		const body = await readJsonBody<SwitchRequestBody>(request)
		const slot = body?.slot
		if (slot == null)
			return toTokenApiResponse(toErrorResponse("Missing slot."))

		const result = await switchToken(paths, String(slot))
		if (!result.success) {
			return toTokenApiResponse(
				toErrorResponse(result.error, 400, "invalid_request_error"),
			)
		}

		return toTokenApiResponse(
			normalizeOpResult(result, listTokenSlots(paths), true),
		)
	}

	// POST /api/tokens/rotate — rotate (re-authenticate) current token
	if (request.method === "POST" && pathname === "/api/tokens/rotate") {
		const result = await rotateToken(paths)
		if (!result.success) {
			return toTokenApiResponse(
				toErrorResponse(result.error, 400, "invalid_request_error"),
			)
		}

		return toTokenApiResponse(
			normalizeOpResult(result, listTokenSlots(paths), true),
		)
	}

	// DELETE /api/tokens/slots/:slot — delete a token slot
	if (
		request.method === "DELETE" &&
		pathname.startsWith("/api/tokens/slots/")
	) {
		const slot = extractSlotNumber(pathname)
		if (!slot) return toTokenApiResponse(toErrorResponse("Invalid token slot."))

		const result = await deleteTokenSlot(paths, slot)
		if (!result.success) {
			return toTokenApiResponse(
				toErrorResponse(result.error, 400, "invalid_request_error"),
			)
		}

		return toTokenApiResponse(toJsonResponse({ success: true }))
	}

	// POST /api/tokens/add — import current auth.json as a new vault slot
	if (request.method === "POST" && pathname === "/api/tokens/add") {
		const body = await readJsonBody<AddRequestBody>(request)
		if (body?.sourcePath) {
			return toTokenApiResponse(
				toErrorResponse(
					"Custom source path import is not supported.",
					400,
					"invalid_request_error",
				),
			)
		}

		const defaultSourcePath = join(paths.authDir, "auth.json")
		const result = await addTokenToVault(paths, defaultSourcePath)
		if (!result.success) {
			// Redact path-containing errors from vault-ops
			const error =
				result.error.includes("/") || result.error.includes("\\")
					? "Failed to add token from default location."
					: result.error
			return toTokenApiResponse(
				toErrorResponse(error, 400, "invalid_request_error"),
			)
		}

		return toTokenApiResponse(
			toJsonResponse({
				success: true,
				slot: toRedactedSlot(result.slot),
			}),
		)
	}

	return toTokenApiResponse(
		toErrorResponse("Route not found.", 404, "not_found_error"),
	)
}
