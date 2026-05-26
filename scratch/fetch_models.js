import { createCodexOAuthClient, loadAuthTokens } from "../packages/openai-oauth-core/src/index.js";
import { resolveOpenAIOAuthModels } from "../packages/openai-oauth/src/models.js";

async function main() {
    try {
        const client = createCodexOAuthClient({
            authFilePath: "C:\\Users\\U-N-00658\\.codex\\auth.json",
        });
        const models = await resolveOpenAIOAuthModels(client, undefined);
        console.log("AVAILABLE_MODELS=" + models.join(","));
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
