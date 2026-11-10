// local provider (PAGINAVIVA_LLM=local): a local OpenAI-compatible model server (Ollama /v1,
// LM Studio) configured by environment, through the same adapter as the registry entries
// (decision D20). PAGINAVIVA_LOCAL_LLM_URL defaults to Ollama; PAGINAVIVA_LOCAL_LLM_MODEL is
// required. 8 GB of VRAM limits it to small quantized vision models (docs/dev-setup.md).
import { OpenAiCompatProvider } from "./openai-compat.ts";
import { LlmError, type LlmProvider, type StructuredRequest, type StructuredResponse } from "./types.ts";

export const DEFAULT_LOCAL_LLM_URL = "http://localhost:11434/v1";

export class LocalProvider implements LlmProvider {
  readonly name = "local";
  readonly model?: string;
  private readonly inner?: OpenAiCompatProvider;

  constructor(url?: string, model?: string) {
    this.model = model;
    if (model)
      this.inner = new OpenAiCompatProvider({ id: "local", baseUrl: url || DEFAULT_LOCAL_LLM_URL, model, vision: true, jsonSchema: true });
  }

  async generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
    if (!this.inner) throw new LlmError("not_configured", "local LLM provider needs PAGINAVIVA_LOCAL_LLM_MODEL (and PAGINAVIVA_LOCAL_LLM_URL if not Ollama)");
    return this.inner.generateStructured(req);
  }
}
