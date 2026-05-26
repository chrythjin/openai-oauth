import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

type StoredRow = {
	id: string
	timestamp: string
	type: "chat_request" | "chat_response" | "chat_error"
	request_id: string
	path: string
	model: string | null
	status: number | null
	duration_ms: number
	input_tokens: number
	output_tokens: number
	total_tokens: number
	error_message: string | null
	stream: number
}

// Global Map keyed by database path to share data among connections to the same file
const tables = new Map<string, StoredRow[]>()

class MockStatement {
	constructor(
		private readonly database: Database,
		private readonly sql: string,
	) {}

	private getRows(): StoredRow[] {
		return tables.get(this.database.pathKey) ?? []
	}

	private setRows(rows: StoredRow[]): void {
		tables.set(this.database.pathKey, rows)
	}

	run(...params: unknown[]) {
		const rows = this.getRows()
		if (this.sql.startsWith("DELETE FROM request_logs WHERE timestamp <")) {
			const cutoff = String(params[0])
			const retained = rows.filter((row) => row.timestamp >= cutoff)
			this.setRows(retained)
			return { changes: rows.length - retained.length }
		}

		if (this.sql.includes("INSERT INTO request_logs")) {
			rows.push({
				id: String(params[0]),
				timestamp: String(params[1]),
				type: params[2] as StoredRow["type"],
				request_id: String(params[3]),
				path: String(params[4]),
				model: params[5] === null ? null : String(params[5]),
				status: params[6] === null ? null : Number(params[6]),
				duration_ms: Number(params[7]),
				input_tokens: Number(params[8]),
				output_tokens: Number(params[9]),
				total_tokens: Number(params[10]),
				error_message: params[11] === null ? null : String(params[11]),
				stream: Number(params[12]),
			})
			this.setRows(rows)
			return { changes: 1 }
		}

		return { changes: 0 }
	}

	get(...params: unknown[]) {
		const rows = this.getRows()
		if (this.sql.includes("COUNT(*) AS count")) {
			return {
				count: rows.filter((row) => row.request_id === params[0]).length,
			}
		}

		return {
			request_count: rows.filter((row) => row.type === "chat_request").length,
			response_count: rows.filter((row) => row.type === "chat_response").length,
			error_count: rows.filter((row) => row.type === "chat_error").length,
			total_input_tokens: rows.reduce(
				(total, row) => total + row.input_tokens,
				0,
			),
			total_output_tokens: rows.reduce(
				(total, row) => total + row.output_tokens,
				0,
			),
			total_tokens: rows.reduce((total, row) => total + row.total_tokens, 0),
			total_duration_ms: rows.reduce(
				(total, row) => total + row.duration_ms,
				0,
			),
		}
	}

	all(...params: unknown[]) {
		const rows = this.getRows()
		if (this.sql.includes("GROUP BY hour")) {
			const grouped = new Map<
				string,
				{
					hour: string
					request_count: number
					response_count: number
					error_count: number
					total_tokens: number
				}
			>()
			for (const row of rows) {
				const hour = `${row.timestamp.slice(0, 13)}:00:00.000Z`
				const bucket = grouped.get(hour) ?? {
					hour,
					request_count: 0,
					response_count: 0,
					error_count: 0,
					total_tokens: 0,
				}
				if (row.type === "chat_request") bucket.request_count += 1
				if (row.type === "chat_response") bucket.response_count += 1
				if (row.type === "chat_error") bucket.error_count += 1
				bucket.total_tokens += row.total_tokens
				grouped.set(hour, bucket)
			}
			return [...grouped.values()].sort((a, b) => a.hour.localeCompare(b.hour))
		}

		const limit = Number(params[0] ?? 50)
		return [...rows]
			.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
			.slice(0, limit)
	}
}

export class Database {
	public readonly pathKey: string

	constructor(databasePath?: string) {
		const resolvedPath = databasePath ? path.resolve(databasePath) : ":memory:"
		this.pathKey = resolvedPath

		if (databasePath) {
			try {
				mkdirSync(path.dirname(databasePath), { recursive: true })
				writeFileSync(databasePath, "")
			} catch {}
		}

		if (!tables.has(resolvedPath)) {
			tables.set(resolvedPath, [])
		}
	}

	exec() {}
	prepare(sql: string) {
		return new MockStatement(this, sql)
	}
	close() {}
}
