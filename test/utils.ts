import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { initEccLib, Network, networks, Psbt } from "bitcoinjs-lib";
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

export type MultisigParticipant = {
  name: string;
  keyPair: ReturnType<typeof ECPair.fromPrivateKey>;
  keyInfo: { address: string; publicKeyHex: string };
};

export type TargetUtxo = {
  txid: string;
  vout: number;
  valueSats: bigint;
};

export type P2wshSpendContext = {
  address: string;
  output: Uint8Array;
  witnessScript: Uint8Array;
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

/**
 * 用 dummy 最大尺寸签名填充未签名 PSBT 的副本，让 bitcoinjs-lib 直接算
 * virtualSize，全程无需任何真实签名方参与。
 */
export const estimateVsizeWithDummySigs = (unsignedPsbt: Psbt): number => {
  // witness stack 二进制序列化（仅处理单项 < 253B 的常规情况）
  const serializeWitness = (items: Buffer[]): Buffer =>
    Buffer.concat([
      Buffer.from([items.length]),
      ...items.flatMap((item) => [Buffer.from([item.length]), item]),
    ]);

  const probe = Psbt.fromHex(unsignedPsbt.toHex(), {
    network: networks.testnet,
  });

  for (let i = 0; i < probe.data.inputs.length; i++) {
    probe.finalizeInput(i, (_idx, inp) => {
      const empty = Buffer.alloc(0);
      if (inp.witnessScript) {
        const m = inp.witnessScript[0] - 0x50;
        const dummySig = Buffer.alloc(73); // max DER(72) + sighash type(1)
        return {
          finalScriptSig: empty,
          finalScriptWitness: serializeWitness([
            empty, // CHECKMULTISIG 占位空项
            ...Array.from({ length: m }, () => dummySig),
            inp.witnessScript,
          ]),
        };
      }
      if (inp.witnessUtxo) {
        const s = inp.witnessUtxo.script;
        if (s.length === 22 && s[0] === 0x00 && s[1] === 0x14) {
          return {
            finalScriptSig: empty,
            finalScriptWitness: serializeWitness([
              Buffer.alloc(73), // dummy sig
              Buffer.alloc(33), // dummy compressed pubkey
            ]),
          };
        }
      }
      // 兜底：返回空，让 bitcoinjs-lib 走默认逻辑
      return { finalScriptSig: empty, finalScriptWitness: empty };
    });
  }

  return probe.extractTransaction().virtualSize();
};

export const buildUnsignedPsbt = ({
  targetUtxo,
  p2wsh,
  toAddress,
  amountSats,
  withChange,
  network = networks.testnet,
}: {
  targetUtxo: TargetUtxo;
  p2wsh: P2wshSpendContext;
  toAddress: string;
  amountSats: bigint;
  withChange: boolean;
  network?: Network;
}): Psbt => {
  const psbt = new Psbt({ network });
  psbt.addInput({
    hash: targetUtxo.txid,
    index: targetUtxo.vout,
    witnessUtxo: { script: p2wsh.output, value: targetUtxo.valueSats },
    witnessScript: p2wsh.witnessScript,
  });
  psbt.addOutput({ address: toAddress, value: amountSats });
  if (withChange) {
    psbt.addOutput({ address: p2wsh.address, value: 1n }); // 仅占位，影响结构
  }
  return psbt;
};

export const buildPsbt = async ({
  feeSats,
  targetUtxo,
  amountSats,
  toAddress,
  p2wsh,
  participants,
  network = networks.testnet,
}: {
  feeSats: bigint;
  targetUtxo: TargetUtxo;
  amountSats: bigint;
  toAddress: string;
  p2wsh: P2wshSpendContext;
  participants: MultisigParticipant[];
  network?: Network;
}) => {
  const change = targetUtxo.valueSats - amountSats - feeSats;
  if (change < 0n) {
    throw new Error(
      `余额不足：utxo=${targetUtxo.valueSats.toString()} sats, amount=${amountSats.toString()} sats, fee=${feeSats.toString()} sats`,
    );
  }

  const psbt = new Psbt({ network });
  psbt.addInput({
    hash: targetUtxo.txid,
    index: targetUtxo.vout,
    witnessUtxo: {
      script: p2wsh.output,
      value: targetUtxo.valueSats,
    },
    witnessScript: p2wsh.witnessScript,
  });
  psbt.addOutput({ address: toAddress, value: amountSats });
  if (change > 0n) {
    psbt.addOutput({ address: p2wsh.address, value: change });
  }

  const unsignedPsbtHex = psbt.toHex();
  // 从 3 个签名方里随机选 2 个拿 partialSig（2-of-3）
  const signerPool = [...participants];
  signerPool.sort(() => Math.random() - 0.5);
  const pickedSigners = signerPool.slice(0, 2);
  console.log(
    "picked signers",
    pickedSigners.map((p) => ({
      name: p.name,
      address: p.keyInfo.address,
      pubkey: p.keyInfo.publicKeyHex,
    })),
  );
  const partialSigs = await Promise.all(
    pickedSigners.map((p) => mockPostGetPartialSig(unsignedPsbtHex, p.keyPair)),
  );

  psbt.updateInput(0, { partialSig: partialSigs });
  psbt.finalizeAllInputs();
  return { psbt, change };
};
