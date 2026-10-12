import { ISemanticJudge, SemanticJudgeVerdict } from "./ISemanticJudge.js";
import { HeuristicSemanticJudge } from "./HeuristicSemanticJudge.js";

/**
 * Motor de Avaliação Semântica Remoto via IA (LLM / Embeddings).
 * 
 * Permite que nós do Oráculo deleguem a classificação semântica profunda
 * para um cluster de IA seguro e adaptativo, protegendo as heurísticas contra
 * ataques adversariais de engenharia reversa.
 */
export class RemoteAiSemanticJudge implements ISemanticJudge {
  private fallbackJudge: HeuristicSemanticJudge;
  private endpointUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(endpointUrl: string, apiKey?: string, timeoutMs = 4000) {
    this.endpointUrl = endpointUrl;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fallbackJudge = new HeuristicSemanticJudge();
  }

  async judge(msgClass: string, text: string): Promise<SemanticJudgeVerdict> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(this.endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ msgClass, text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        console.warn(`[ORACLE-AI] Juiz remoto retornou status ${res.status}. Acionando fallback heurístico...`);
        return this.fallbackJudge.judge(msgClass, text);
      }

      const data = (await res.json()) as any;
      return {
        isSpoofed: Boolean(data.isSpoofed),
        reason: String(data.reason || "Veredito emitido pelo Tribunal de IA"),
        confidence: typeof data.confidence === "number" ? data.confidence : 0.95,
        engine: "remote-ai-llm",
      };
    } catch (err: any) {
      console.warn(`[ORACLE-AI] Falha de comunicação com motor de IA remoto (${err.message}). Acionando fallback heurístico...`);
      return this.fallbackJudge.judge(msgClass, text);
    }
  }
}
