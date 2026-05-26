import { useCallback, useEffect, useState } from "react"
import {
	Area,
	AreaChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts"
import type { HourlyStat, LogEntry, SummaryData } from "../types"

async function fetch_json<T>(url: string): Promise<T | null> {
	try {
		const r = await fetch(url)
		if (!r.ok) return null
		return r.json() as Promise<T>
	} catch {
		return null
	}
}

const defaultSummary: SummaryData = {
	totalRequests: 0,
	totalTokens: 0,
	errorCount: 0,
	uptime: "—",
}

function coerceNumber(value: unknown): number {
	const n = Number(value)
	return Number.isFinite(n) ? n : 0
}

function coerceSummary(raw: unknown): SummaryData {
	if (!raw || typeof raw !== "object") return { ...defaultSummary }
	const o = raw as Record<string, unknown>
	const totalRequests =
		coerceNumber(o.totalRequests) || coerceNumber(o.requests)
	const totalTokens =
		coerceNumber(o.totalTokens) ||
		coerceNumber(o.tokens_in) + coerceNumber(o.tokens_out)
	const errorCount = coerceNumber(o.errorCount)
	const uptime = typeof o.uptime === "string" ? o.uptime : defaultSummary.uptime
	return { totalRequests, totalTokens, errorCount, uptime }
}

function coerceHourly(raw: unknown): HourlyStat[] {
	if (!Array.isArray(raw)) return []
	return raw.filter(
		(row): row is HourlyStat =>
			!!row &&
			typeof row === "object" &&
			typeof (row as HourlyStat).hour === "string" &&
			typeof (row as HourlyStat).requests === "number",
	)
}

function coerceLogs(raw: unknown): LogEntry[] {
	if (Array.isArray(raw)) return raw as LogEntry[]
	if (
		raw &&
		typeof raw === "object" &&
		Array.isArray((raw as { logs?: unknown }).logs)
	) {
		return (raw as { logs: LogEntry[] }).logs
	}
	return []
}

export default function UsageTab() {
	const [summary, setSummary] = useState<SummaryData | null>(null)
	const [hourly, setHourly] = useState<HourlyStat[]>([])
	const [logs, setLogs] = useState<LogEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [apiError, setApiError] = useState<string | null>(null)

	const load = useCallback(async () => {
		setApiError(null)
		const [sum, hr, lg] = await Promise.all([
			fetch_json<unknown>("/api/dashboard/summary"),
			fetch_json<unknown>("/api/dashboard/hourly"),
			fetch_json<unknown>("/api/dashboard/logs"),
		])
		if (sum === null && hr === null && lg === null) {
			setApiError("Dashboard data unavailable. Check proxy status.")
		}
		setSummary(coerceSummary(sum))
		setHourly(coerceHourly(hr))
		setLogs(coerceLogs(lg))
		setLoading(false)
	}, [])

	useEffect(() => {
		load()
		const id = setInterval(load, 30_000)
		return () => clearInterval(id)
	}, [load])

	if (loading) return <div className="loading">Loading…</div>

	return (
		<>
			{apiError && (
				<div data-testid="usage-error-banner" className="error-banner">
					{apiError}
				</div>
			)}
			{/* Summary cards */}
			<div className="summary-grid">
				<div className="summary-card">
					<div className="label">Total Requests</div>
					<div className="value">
						{summary?.totalRequests?.toLocaleString() ?? "—"}
					</div>
				</div>
				<div className="summary-card">
					<div className="label">Total Tokens</div>
					<div className="value">
						{summary?.totalTokens?.toLocaleString() ?? "—"}
					</div>
				</div>
				<div className="summary-card">
					<div className="label">Errors</div>
					<div
						className="value"
						style={{ color: summary?.errorCount ? "var(--danger)" : undefined }}
					>
						{summary?.errorCount?.toLocaleString() ?? "—"}
					</div>
				</div>
				<div className="summary-card">
					<div className="label">Uptime</div>
					<div className="value" style={{ fontSize: 20 }}>
						{summary?.uptime ?? "—"}
					</div>
				</div>
			</div>

			{/* Hourly chart */}
			<div className="chart-wrapper">
				<h2>Requests — Last 24 Hours</h2>
				<ResponsiveContainer width="100%" height={200}>
					<AreaChart
						data={hourly}
						margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
					>
						<defs>
							<linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
								<stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
								<stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
							</linearGradient>
						</defs>
						<XAxis
							dataKey="hour"
							tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
							tickLine={false}
							axisLine={false}
						/>
						<YAxis
							tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
							tickLine={false}
							axisLine={false}
							width={30}
							tickFormatter={(val) => (val || 0).toLocaleString()}
						/>
						<Tooltip
							formatter={(value: any) => [
								value?.toLocaleString?.() ?? value,
								"Requests",
							]}
							contentStyle={{
								background: "var(--surface)",
								backdropFilter: "blur(20px)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								fontSize: 12,
							}}
						/>
						<Area
							type="monotone"
							dataKey="requests"
							stroke="var(--accent)"
							strokeWidth={2}
							fill="url(#reqGrad)"
						/>
						<Area
							type="monotone"
							dataKey="tokens"
							stroke="#82ca9d"
							fill="#82ca9d"
							fillOpacity={0.3}
							name="tokens"
						/>
					</AreaChart>
				</ResponsiveContainer>
			</div>

			{/* Log table */}
			<div className="log-table-container">
				<h2>Recent Requests</h2>
				{logs.length === 0 ? (
					<div className="empty-state">No requests yet.</div>
				) : (
					<table className="log-table">
						<thead>
							<tr>
								<th>Time</th>
								<th>Type</th>
								<th>Path</th>
								<th>Model</th>
								<th>Duration</th>
								<th>Tokens</th>
							</tr>
						</thead>
						<tbody>
							{logs.map((log) => (
								<tr key={log.id}>
									<td style={{ whiteSpace: "nowrap" }}>
										{new Date(log.timestamp).toLocaleTimeString()}
									</td>
									<td>
										<span className={`log-type ${log.type}`}>
											{log.type.replace("chat_", "")}
										</span>
									</td>
									<td>{log.path}</td>
									<td>{log.model ?? "—"}</td>
									<td>
										{log.durationMs != null ? `${log.durationMs}ms` : "—"}
									</td>
									<td>
										{log.usage
											? `${log.usage.inputTokens}→${log.usage.outputTokens}`
											: "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</>
	)
}
