import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { initEccLib, networks, Psbt } from "bitcoinjs-lib";
initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

export type Utxo = { txid: string; vout: number; value: number };
export type RecommendedFees = {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
};

export async function fetchUtxos(addr: string): Promise<Utxo[]> {
  const url = `https://mempool.space/testnet/api/address/${addr}/utxo`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`拉取 UTXO 失败 ${res.status} ${res.statusText}: ${txt}`);
  }
  return (await res.json()) as Utxo[];
}

export async function fetchFeeRateSatPerVb(): Promise<number> {
  const url = "https://mempool.space/testnet/api/v1/fees/recommended";
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`拉取费率失败 ${res.status} ${res.statusText}: ${txt}`);
  }
  const fees = (await res.json()) as RecommendedFees;
  const fr = fees.fastestFee;
  if (!Number.isFinite(fr) || fr <= 0) throw new Error("推荐费率无效");
  return fr;
}

export const mockPostGetPartialSig = async (
  unsignedPsbtHex: string,
  keyPair: ReturnType<typeof ECPair.fromPrivateKey>,
) => {
  // 模拟“远端签名服务”：入参是 unsigned psbt，出参仅包含签名结果（不暴露 signer）
  await new Promise((resolve) => setTimeout(resolve, 20));
  const remotePsbt = Psbt.fromHex(unsignedPsbtHex, {
    network: networks.testnet,
  });
  await remotePsbt.signInputAsync(0, keyPair);
  const partialSig = remotePsbt.data.inputs[0].partialSig?.find((item) =>
    Buffer.from(item.pubkey).equals(Buffer.from(keyPair.publicKey)),
  );
  if (!partialSig) {
    throw new Error("远端签名服务未返回 partialSig");
  }
  return {
    pubkey: Buffer.from(partialSig.pubkey),
    signature: Buffer.from(partialSig.signature),
  };
};
