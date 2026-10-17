import { PublicKey, Secp256k1Program, TransactionInstruction } from "@solana/web3.js";
import { hexToBytes, type Address, type Hex } from "viem";

const OFFSETS_SIZE = 11;
const HEADER_SIZE = 1 + OFFSETS_SIZE;
const ETH_ADDRESS_SIZE = 20;
const SIGNATURE_SIZE = 64;

function putU16(target: Buffer, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new Error("secp256k1 offset exceeds u16");
  target.writeUInt16LE(value, offset);
}

/**
 * Builds a compact secp256k1 precompile instruction. The signed message is
 * referenced from the following MAIVW instruction instead of being duplicated.
 */
export function createCompactSecp256k1Instruction(input: {
  ethAddress: Address;
  signature: Hex;
  messageOffset: number;
  messageLength: number;
  selfInstructionIndex?: number;
  messageInstructionIndex?: number;
}): TransactionInstruction {
  const address = Buffer.from(hexToBytes(input.ethAddress));
  const signature = Buffer.from(hexToBytes(input.signature));
  if (address.length !== ETH_ADDRESS_SIZE || signature.length !== SIGNATURE_SIZE + 1) {
    throw new Error("invalid secp256k1 address or recoverable signature");
  }
  const recoveryId = signature[SIGNATURE_SIZE] >= 27
    ? signature[SIGNATURE_SIZE] - 27
    : signature[SIGNATURE_SIZE];
  if (recoveryId > 1) throw new Error("secp256k1 recovery id must be 0 or 1");
  const addressOffset = HEADER_SIZE;
  const signatureOffset = addressOffset + ETH_ADDRESS_SIZE;
  const data = Buffer.alloc(signatureOffset + SIGNATURE_SIZE + 1);
  data[0] = 1;
  putU16(data, 1, signatureOffset);
  data[3] = input.selfInstructionIndex ?? 0;
  putU16(data, 4, addressOffset);
  data[6] = input.selfInstructionIndex ?? 0;
  putU16(data, 7, input.messageOffset);
  putU16(data, 9, input.messageLength);
  data[11] = input.messageInstructionIndex ?? 1;
  address.copy(data, addressOffset);
  signature.subarray(0, SIGNATURE_SIZE).copy(data, signatureOffset);
  data[signatureOffset + SIGNATURE_SIZE] = recoveryId;
  return new TransactionInstruction({ programId: Secp256k1Program.programId, keys: [], data });
}
