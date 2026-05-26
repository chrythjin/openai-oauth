import { cpSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const src = resolve(import.meta.dirname, "../../openai-oauth-dashboard/dist")
const dest = resolve(import.meta.dirname, "../dist/dashboard")

if (!existsSync(src)) {
	console.log("Dashboard not built yet, skipping copy.")
	process.exit(0)
}

cpSync(src, dest, { recursive: true, force: true })
console.log("Dashboard copied to dist/dashboard")
