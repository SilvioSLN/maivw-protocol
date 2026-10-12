/**
 * Interface padronizada para o Juiz Semântico do Oráculo MAIVW (Fase 8).
 * 
 * Permite que diferentes motores de avaliação (heurístico local, LLM remoto,
 * embeddings vetoriais ou modelo proprietário corporativo) sejam plugados
 * sem alterar a lógica de governança e staking do protocolo.
 */
export interface SemanticJudgeVerdict {
  isSpoofed: boolean;
  reason: string;
  confidence?: number;
  engine?: string;
}

export interface ISemanticJudge {
  /**
   * Avalia se o conteúdo textual condiz estritamente com a MessageClass declarada.
   */
  judge(msgClass: string, text: string): Promise<SemanticJudgeVerdict> | SemanticJudgeVerdict;
}
