declare module "bun:sqlite" {
	export class Database {
		constructor(path?: string)
		exec(sql: string): void
		prepare(query: string): Statement
		close(): void
	}

	export class Statement {
		run(...params: unknown[]): unknown
	}
}
