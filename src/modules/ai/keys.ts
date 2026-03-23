import { env } from "../../config/env";

export function getDevKeys() {
    return {
        openai: env.isDev ? __OPENAI_API_KEY__ : "",
        openrouter: env.isDev ? __OPENROUTER_API_KEY__ : ""
    };
    
}