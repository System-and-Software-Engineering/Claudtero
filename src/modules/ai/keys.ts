export function getDevKeys() {
    return {
        openai: __env__ === "development" ? __OPENAI_API_KEY__ : "",
        openrouter: __env__ === "development" ? __OPENROUTER_API_KEY__ : ""
    };
    
}