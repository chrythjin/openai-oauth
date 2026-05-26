import { promises as fs } from "node:fs"
import path from "node:path"

const DASHBOARD_PREFIX = "/dashboard"
const INDEX_FILE = "index.html"

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".wasm": "application/wasm",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".avif": "image/avif",
	".webp": "image/webp",
}

const toNotFoundResponse = (message: string): Response =>
	new Response(JSON.stringify({ error: message }), {
		status: 404,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	})

const getContentType = (filePath: string): string => {
	const extension = path.extname(filePath).toLowerCase()
	return CONTENT_TYPES[extension] ?? "application/octet-stream"
}

const isInsideBasePath = (basePath: string, targetPath: string): boolean => {
	const relative = path.relative(basePath, targetPath)
	return (
		relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
	)
}

export const handleDashboardStaticRequest = async (
	request: Request,
	dashboardDistPath: string,
): Promise<Response> => {
	const url = new URL(request.url)
	const pathname = url.pathname
	const relativePath =
		pathname === DASHBOARD_PREFIX
			? ""
			: pathname.startsWith(`${DASHBOARD_PREFIX}/`)
				? pathname.slice(DASHBOARD_PREFIX.length + 1)
				: pathname.replace(/^\//, "")

	const basePath = path.resolve(dashboardDistPath)
	const resolvedPath = path.resolve(basePath, relativePath)

	if (resolvedPath !== basePath && !isInsideBasePath(basePath, resolvedPath)) {
		return toNotFoundResponse("Not found.")
	}

	const extension = path.extname(resolvedPath)
	let filePath = resolvedPath
	let isIndex = false

	try {
		const stats = await fs.stat(resolvedPath)
		if (stats.isDirectory() || extension === "") {
			filePath = path.join(basePath, INDEX_FILE)
			isIndex = true
		}
	} catch {
		if (extension === "") {
			filePath = path.join(basePath, INDEX_FILE)
			isIndex = true
		} else {
			return toNotFoundResponse("Not found.")
		}
	}

	try {
		const body = await fs.readFile(filePath)
		return new Response(new Uint8Array(body), {
			status: 200,
			headers: {
				"Cache-Control": isIndex ? "no-cache" : "public, max-age=3600",
				"Content-Type": getContentType(filePath),
			},
		})
	} catch {
		return toNotFoundResponse("Not found.")
	}
}
