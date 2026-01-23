export function getDevKeys() {
    // TODO: Treat keys as missing in production builds
    const isDev = __env__ === "development";

    if (isDev && !__OPENAI_API_KEY__) {
        throw new Error("Missing OPENAI_API_KEY in .env");
    }

    if (isDev && !__OPENROUTER_API_KEY__) {
        throw new Error("Missing OPENROUTER_API_KEY in .env")
    }

    return {
        openai: isDev ? __OPENAI_API_KEY__ : "",
        openrouter: isDev ? __OPENROUTER_API_KEY__ : ""
    };
    
}