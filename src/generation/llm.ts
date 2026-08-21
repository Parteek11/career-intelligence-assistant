import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

let llm: ChatGroq | null = null;

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

export async function completeJson(system: string, user: string): Promise<string> {
  const response = await getLlm().invoke([new SystemMessage(system), new HumanMessage(user)], {
    response_format: { type: "json_object" },
  });

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}
