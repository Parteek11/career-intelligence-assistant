import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Thin Groq wrapper used by analysis and Best Match.
 *
 * The client is created once per process (`llm` module singleton) so we
 * do not rebuild the LangChain chat model on every request. Temperature
 * is 0: we want structured JSON, not creative variation. The model name
 * defaults to `openai/gpt-oss-120b` but can be overridden with `GROQ_MODEL`.
 */
let llm: ChatGroq | null = null;

/** Lazy-init the Groq client. Fails fast if `GROQ_API_KEY` is missing. */
function getLlm(): ChatGroq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set. Copy .env.example to .env and add a Groq API key.");
  }

  if (!llm) {
    llm = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
      temperature: 0,
    });
  }

  return llm;
}

/**
 * Ask the model for a single JSON object.
 *
 * `response_format: { type: "json_object" }` is Groq's structured-output
 * flag — the model is constrained to emit JSON, which `parse.ts` then
 * validates field-by-field. Content is usually a string; if LangChain
 * returns a structured part list we stringify it so the parser still runs.
 */
export async function completeJson(system: string, user: string): Promise<string> {
  const response = await getLlm().invoke([new SystemMessage(system), new HumanMessage(user)], {
    response_format: { type: "json_object" },
  });

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}
