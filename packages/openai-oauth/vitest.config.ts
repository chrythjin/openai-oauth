import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		alias: {
			"bun:sqlite": path.resolve(
				import.meta.dirname,
				"./test/bun-sqlite-mock.ts",
			),
		},
	},
})
