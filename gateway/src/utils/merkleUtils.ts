import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

/**
 * Utilitários criptográficos de Merkle Tree para o protocolo MAIVW (Fase 6).
 * Permite agregação de milhares de domínios destinatários em um único root de 32 bytes gravado on-chain.
 */

/**
 * Gera o hash keccak256 determinístico de um domínio destinatário (folha da árvore).
 */
export function hashDomain(domain: string): Buffer {
  return keccak256(domain.toLowerCase().trim());
}

/**
 * Constrói a Merkle Tree a partir de uma lista de domínios destinatários.
 */
export function buildMerkleTree(domains: string[]): MerkleTree {
  const leaves = domains.map(hashDomain);
  return new MerkleTree(leaves, keccak256, { sortPairs: true });
}

/**
 * Retorna o Merkle Root formatado como string hexadecimal 0x...
 */
export function getMerkleRootHex(tree: MerkleTree): `0x${string}` {
  return `0x${tree.getRoot().toString("hex")}` as `0x${string}`;
}

/**
 * Retorna a prova de inclusão (Merkle Proof) específica para um domínio destinatário.
 */
export function getMerkleProofHex(tree: MerkleTree, domain: string): `0x${string}`[] {
  const leaf = hashDomain(domain);
  return tree.getHexProof(leaf) as `0x${string}`[];
}

/**
 * Verifica criptograficamente se um domínio pertence ao Merkle Root utilizando a prova fornecida.
 */
export function verifyDomainMerkleProof(
  domain: string,
  rootHex: string,
  proofHexArray: string[]
): boolean {
  try {
    const cleanRoot = rootHex.startsWith("0x") ? rootHex.slice(2) : rootHex;
    const rootBuf = Buffer.from(cleanRoot, "hex");
    const leafBuf = hashDomain(domain);
    const proofBufs = proofHexArray.map((p) => {
      const cleanP = p.startsWith("0x") ? p.slice(2) : p;
      return Buffer.from(cleanP, "hex");
    });
    return MerkleTree.verify(proofBufs, leafBuf, rootBuf, keccak256, { sortPairs: true });
  } catch {
    return false;
  }
}
