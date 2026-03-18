import { describe, expect, it } from "vitest";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { initEccLib, networks, payments } from "bitcoinjs-lib";
import { deriveBtcFromMnemonic } from "../src/mnemonic";

initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

describe("助记词生成私钥", () => {
  it("同一助记词在同一路径下派生结果稳定，且地址可由私钥复现", () => {
    // BIP39 测试向量之一（常见示例助记词）
    const mnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const derived = deriveBtcFromMnemonic({
      mnemonic,
      network: "mainnet",
      addressType: "p2wpkh",
      account: 0,
      change: 0,
      index: 0,
    });

    const keyPair = ECPair.fromPrivateKey(
      Buffer.from(derived.privateKeyHex, "hex"),
    );
    const addr2 = payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: networks.bitcoin,
    }).address!;

    expect(addr2).toBe(derived.address);

    const derived_testnet = deriveBtcFromMnemonic({
      mnemonic,
      network: "testnet",
      addressType: "p2wpkh",
      account: 0,
      change: 0,
      index: 0,
    });

    const keyPair_testnet = ECPair.fromPrivateKey(
      Buffer.from(derived_testnet.privateKeyHex, "hex"),
    );
    const addr2_testnet = payments.p2wpkh({
      pubkey: Buffer.from(keyPair_testnet.publicKey),
      network: networks.testnet,
    }).address!;
    expect(addr2_testnet).toBe(derived_testnet.address);
  });
});
