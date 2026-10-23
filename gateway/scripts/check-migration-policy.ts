import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(__dirname, "../prisma/migrations");

export interface PolicyCheckResult {
  migrationName: string;
  isCompliant: boolean;
  warnings: string[];
  violations: string[];
}

/**
 * Valida se uma migração SQL segue a política Expand -> Migrate -> Contract:
 * 1. Mudanças devem ser aditivas (Expand) durante a janela de compatibilidade (N-1).
 * 2. Novas colunas devem ser opcionais (nullable) ou possuir valor DEFAULT.
 * 3. Operações destrutivas (DROP TABLE, DROP COLUMN, RENAME COLUMN) requerem anotação
 *    explícita de fase de contração ("CONTRACT_PHASE") após encerramento da janela de compatibilidade.
 */
export function checkMigrationSql(migrationName: string, sqlContent: string): PolicyCheckResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  const lines = sqlContent.split(/\r?\n/);
  const isContractPhase = sqlContent.includes("/* CONTRACT_PHASE */") || sqlContent.includes("-- CONTRACT_PHASE");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("--") || line.startsWith("/*") || line === "") continue;

    // 1. Proibição de DROP COLUMN sem contrato explícito
    if (/ALTER\s+TABLE\s+.*DROP\s+COLUMN/i.test(line)) {
      if (!isContractPhase) {
        violations.push(
          `Linha ${i + 1}: DROP COLUMN detectado sem anotação 'CONTRACT_PHASE'. Viola compatibilidade N-1 com aplicação em execução.`
        );
      }
    }

    // 2. Proibição de DROP TABLE sem contrato explícito
    if (/DROP\s+TABLE/i.test(line)) {
      if (!isContractPhase) {
        violations.push(
          `Linha ${i + 1}: DROP TABLE detectado sem anotação 'CONTRACT_PHASE'. Viola compatibilidade N-1 com aplicação em execução.`
        );
      }
    }

    // 3. Proibição de RENAME COLUMN direto (deve-se adicionar nova coluna, migrar dados e contrair depois)
    if (/RENAME\s+COLUMN/i.test(line)) {
      if (!isContractPhase) {
        violations.push(
          `Linha ${i + 1}: RENAME COLUMN quebra compatibilidade retroativa. Use estratégia Expand (adicionar nova coluna) -> Migrate -> Contract.`
        );
      }
    }

    // 4. Verificação de ADD COLUMN NOT NULL sem DEFAULT
    if (/ADD\s+COLUMN\s+.*NOT\s+NULL/i.test(line) && !/DEFAULT/i.test(line)) {
      violations.push(
        `Linha ${i + 1}: ADD COLUMN NOT NULL sem cláusula DEFAULT impede inserções de réplicas rodando versão anterior (N-1).`
      );
    }
  }

  return {
    migrationName,
    isCompliant: violations.length === 0,
    warnings,
    violations,
  };
}

export function validateAllMigrations(migrationsDir = defaultMigrationsDir): PolicyCheckResult[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Diretório de migrações não encontrado: ${migrationsDir}`);
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const results: PolicyCheckResult[] = [];

  for (const dirName of migrationDirs) {
    const sqlPath = path.join(migrationsDir, dirName, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
      results.push({
        migrationName: dirName,
        isCompliant: false,
        warnings: [],
        violations: [`Arquivo migration.sql não encontrado no diretório ${dirName}`],
      });
      continue;
    }

    const sql = fs.readFileSync(sqlPath, "utf-8");
    results.push(checkMigrationSql(dirName, sql));
  }

  return results;
}

// Execução direta via CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log("🔍 Validando migrações segundo a política Expand -> Migrate -> Contract...");
  const results = validateAllMigrations();

  let hasErrors = false;
  for (const res of results) {
    if (res.isCompliant) {
      console.log(`  ✅ ${res.migrationName}: em conformidade.`);
    } else {
      hasErrors = true;
      console.error(`  ❌ ${res.migrationName}: violações detectadas:`);
      for (const v of res.violations) {
        console.error(`     - ${v}`);
      }
    }
  }

  if (hasErrors) {
    console.error("\n❌ Validação da política de migração reprovada.");
    process.exit(1);
  } else {
    console.log(`\n✅ Todas as ${results.length} migrações estão em conformidade com Expand -> Migrate -> Contract.`);
  }
}
