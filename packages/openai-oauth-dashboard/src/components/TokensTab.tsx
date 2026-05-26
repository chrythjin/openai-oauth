import { useCallback, useEffect, useState } from "react"
import type { TokenSlot } from "../types"

async function fetch_json<T>(url: string): Promise<T | null> {
	try {
		const r = await fetch(url)
		if (!r.ok) return null
		return r.json() as Promise<T>
	} catch {
		return null
	}
}

interface SlotsResponse {
	slots: TokenSlot[]
}

export default function TokensTab() {
	const [slots, setSlots] = useState<TokenSlot[]>([])
	const [proxyUp, setProxyUp] = useState(false)
	const [restartAlert, setRestartAlert] = useState(false)
	const [loading, setLoading] = useState(true)
	const [actionStatus, setActionStatus] = useState<string | null>(null)
	const [actionError, setActionError] = useState<string | null>(null)
	const [actionPending, setActionPending] = useState(false)

	const loadSlots = useCallback(async () => {
		const data = await fetch_json<SlotsResponse>("/api/tokens/slots")
		setSlots(data?.slots ?? [])
	}, [])

	const loadStatus = useCallback(async () => {
		const r = await fetch_json<{ healthy: boolean }>("/api/dashboard/status")
		setProxyUp(r?.healthy ?? false)
	}, [])

	const load = useCallback(async () => {
		await Promise.all([loadSlots(), loadStatus()])
		setLoading(false)
	}, [loadSlots, loadStatus])

	useEffect(() => {
		load()
		const id = setInterval(load, 30_000)
		return () => clearInterval(id)
	}, [load])

	const doSwitch = async (slot: number) => {
		const r = await fetch("/api/tokens/switch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slot }),
		})
		const data = await r.json().catch(() => null)
		if (data?.restart_required) setRestartAlert(true)
		await loadSlots()
	}

	const doRotate = async () => {
		const r = await fetch("/api/tokens/rotate", { method: "POST" })
		const data = await r.json().catch(() => null)
		if (data?.restart_required) setRestartAlert(true)
		await loadSlots()
	}

	const doDelete = async (slot: number) => {
		if (!confirm(`Delete token slot ${slot}?`)) return
		await fetch(`/api/tokens/slots/${slot}`, { method: "DELETE" })
		await loadSlots()
	}

	const doAdd = async () => {
		setActionPending(true)
		setActionStatus(null)
		setActionError(null)
		try {
			const r = await fetch("/api/tokens/add", { method: "POST" })
			const data = await r.json().catch(() => null)
			if (r.ok && data?.success) {
				setActionStatus("Current auth saved as new slot.")
				await loadSlots()
			} else {
				setActionError(data?.error?.message || "Failed to save auth.")
			}
		} catch {
			setActionError("Network error while saving auth.")
		} finally {
			setActionPending(false)
		}
	}

	if (loading) return <div className="loading">Loading…</div>

	return (
		<>
			{restartAlert && (
				<div data-testid="tokens-restart-required" className="restart-alert">
					<strong>⚠ Restart required</strong>
					&nbsp;Token switch or rotate needs a proxy restart. Run{" "}
					<code>.codex\launchers\manage-tokens.bat restart</code> to apply
					changes. &nbsp;
					<button
						type="button"
						className="btn btn-secondary"
						style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
						onClick={() => setRestartAlert(false)}
					>
						Dismiss
					</button>
				</div>
			)}
			{actionStatus && (
				<div
					data-testid="tokens-action-status"
					className="action-status success"
				>
					{actionStatus}
				</div>
			)}
			{actionError && (
				<div data-testid="tokens-action-error" className="action-status error">
					{actionError}
				</div>
			)}

			<div className="proxy-status">
				<span className={`status-dot${proxyUp ? "" : " down"}`} />
				<span>Proxy status: {proxyUp ? "Running" : "Down"}</span>
				<span
					style={{
						marginLeft: "auto",
						color: "var(--text-secondary)",
						fontSize: 12,
					}}
				>
					{slots.length} token slot{slots.length !== 1 ? "s" : ""}
				</span>
			</div>

			<div style={{ marginBottom: 16 }}>
				<button
					type="button"
					data-testid="tokens-add-button"
					className="btn btn-primary"
					onClick={doAdd}
					disabled={actionPending}
				>
					{actionPending ? "Saving…" : "Save current auth as slot"}
				</button>
			</div>

			<div className="tokens-grid">
				{slots.map((s) => (
					<div
						key={s.slot}
						className={`token-card${s.active ? " active" : ""}`}
					>
						<div className="token-header">
							<span className="token-label">{s.label}</span>
							<span className="token-slot">#{s.slot}</span>
						</div>
						<div className="token-meta">
							<span>{s.inVault ? "In vault" : "Not in vault"}</span>
							{s.expiry ? (
								<span
									className={`token-expiry${new Date(s.expiry) < new Date() ? " expired" : ""}`}
								>
									Expires {new Date(s.expiry).toLocaleString()}
								</span>
							) : (
								<span className="token-expiry">No expiry info</span>
							)}
						</div>
						<div className="token-actions">
							{!s.active && (
								<button
									type="button"
									className="btn btn-primary"
									onClick={() => doSwitch(s.slot)}
								>
									Switch
								</button>
							)}
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => doRotate()}
							>
								Rotate
							</button>
							<button
								type="button"
								className="btn btn-danger"
								onClick={() => doDelete(s.slot)}
								disabled={s.active}
								title={s.active ? "Cannot delete active slot" : undefined}
							>
								Delete
							</button>
						</div>
					</div>
				))}
			</div>

			{slots.length === 0 && (
				<div data-testid="tokens-empty-state" className="empty-state">
					<p>No token slots found.</p>
					<p>
						New login: use the CLI (
						<code>.codex\launchers\manage-tokens.bat</code>).
					</p>
					<p>
						After login, click "Save current auth as slot" above to store it.
					</p>
				</div>
			)}
		</>
	)
}
