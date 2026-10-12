import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  HeuristicSemanticJudge,
  RemoteAiSemanticJudge,
} from "../src/services/semantic/index.js";

describe("SemanticJudge Subsystem — Extensible Moderation Engine", () => {
  test("HeuristicSemanticJudge: deve detectar tag spoofing em TX_CODE com termos comerciais", () => {
    const judge = new HeuristicSemanticJudge();
    const verdict = judge.judge("TX_CODE", "Seu código é 123456. Aproveite 50% off hoje!");
    assert.equal(verdict.isSpoofed, true);
    assert.equal(verdict.engine, "heuristic-rules");
    assert.match(verdict.reason, /TX_CODE contém termos de marketing comercial/);
  });

  test("HeuristicSemanticJudge: deve aprovar mensagem transacional limpa", () => {
    const judge = new HeuristicSemanticJudge();
    const verdict = judge.judge("TX_CODE", "Seu código de confirmação é 987654. Válido por 10 minutos.");
    assert.equal(verdict.isSpoofed, false);
    assert.equal(verdict.engine, "heuristic-rules");
  });

  test("RemoteAiSemanticJudge: deve usar fallback heurístico se o endpoint de IA estiver inacessível", async () => {
    // Aponta para endpoint offline intencional para verificar resiliência de fallback
    const remoteJudge = new RemoteAiSemanticJudge("http://127.0.0.1:9999/api/v1/unavailable-judge", undefined, 500);
    const verdict = await remoteJudge.judge("TX_CODE", "Código 123. Ganhe bônus agora!");
    assert.equal(verdict.isSpoofed, true);
    assert.equal(verdict.engine, "heuristic-rules");
  });
});
