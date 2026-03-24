import { describe, expect, it } from "vitest";
import * as ecc from "tiny-secp256k1";
import { address, initEccLib, networks, payments } from "bitcoinjs-lib";
import { getDerivedKeysFromMnemonic } from "../src/mnemonic";
import dotenv from "dotenv";
import { ECPairFactory } from "ecpair";
import {
  buildPsbt,
  buildUnsignedPsbt,
  estimateVsizeWithDummySigs,
  fetchFeeRateSatPerVb,
  fetchUtxos,
  Utxo,
} from "./utils";
dotenv.config();

initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

describe("创建 BTC 地址", () => {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    throw new Error("MNEMONIC is not set");
  }

  const derivedKeys_mainnet = getDerivedKeysFromMnemonic(
    {
      mnemonic: mnemonic,
      network: "mainnet",
      addressType: "p2wpkh",
    },
    3,
  );

  const derivedKeys_testnet = getDerivedKeysFromMnemonic(
    {
      mnemonic: mnemonic,
      network: "testnet",
      addressType: "p2wpkh",
    },
    3,
  );

  const derivedKeys_testnet_coinType = getDerivedKeysFromMnemonic(
    {
      mnemonic: mnemonic,
      network: "testnet",
      addressType: "p2wpkh",
      coinType: 1, // electrum testnet
    },
    3,
    true,
  );

  console.log(
    "electrum testnet change addresses:",
    derivedKeys_testnet_coinType.map((key) => key.address),
  );

  it("P2WPKH (mainnet/testnet) - 由 BIP173 示例 program 生成 bech32 地址", () => {
    const pubkey_mainnet_0 = Buffer.from(
      derivedKeys_mainnet[0].publicKeyHex,
      "hex",
    );

    const mainnet = payments.p2wpkh({
      pubkey: pubkey_mainnet_0,
      network: networks.bitcoin,
    });
    expect(mainnet.address).toBe(derivedKeys_mainnet[0].address);

    const pubkey_testnet_0 = Buffer.from(
      derivedKeys_testnet[0].publicKeyHex,
      "hex",
    );

    const testnet = payments.p2wpkh({
      pubkey: pubkey_testnet_0,
      network: networks.testnet,
    });
    expect(testnet.address).toBe(derivedKeys_testnet[0].address);

    const decodedMain = address.fromBech32(mainnet.address!);
    expect(decodedMain.prefix).toBe(networks.bitcoin.bech32);
    const decodedTestnet = address.fromBech32(testnet.address!);
    expect(decodedTestnet.prefix).toBe(networks.testnet.bech32);
  });

  it("P2WSH (mainnet/testnet) - (n-1)-of-n multisig 生成 bech32 地址", () => {
    const pubkeys_mainnet = derivedKeys_mainnet.map((key) =>
      Buffer.from(key.publicKeyHex, "hex"),
    );

    const p2wsh_mainnet = payments.p2wsh({
      redeem: payments.p2ms({
        pubkeys: pubkeys_mainnet,
        m: pubkeys_mainnet.length - 1, // (n-1)-of-n multisig
        network: networks.bitcoin,
      }),
      network: networks.bitcoin,
    });
    expect(p2wsh_mainnet.address).toBe(
      "bc1qfdk4dlhzgd7xn6q7v47ptp4099tu5kj9n6fcg2tdq4cn6he5gn3smutcp7",
    );

    const decoded = address.fromBech32(p2wsh_mainnet.address!);
    expect(decoded.prefix).toBe(networks.bitcoin.bech32);

    const pubkeys_testnet = derivedKeys_testnet.map((key) =>
      Buffer.from(key.publicKeyHex, "hex"),
    );

    const p2wsh_testnet = payments.p2wsh({
      redeem: payments.p2ms({
        pubkeys: pubkeys_testnet,
        m: pubkeys_testnet.length - 1, // (n-1)-of-n multisig
        network: networks.testnet,
      }),
      network: networks.testnet,
    });
    expect(p2wsh_testnet.address).toBe(
      "tb1qfdk4dlhzgd7xn6q7v47ptp4099tu5kj9n6fcg2tdq4cn6he5gn3sv5ahm3",
    );

    const decoded_testnet = address.fromBech32(p2wsh_testnet.address!);
    expect(decoded_testnet.prefix).toBe(networks.testnet.bech32);
    expect(Buffer.from(decoded_testnet.data).toString("hex")).toBe(
      Buffer.from(decoded.data).toString("hex"),
    );
  });

  it("P2WSH (testnet) - (n-1)-of-n multisig withdraw 0.0001 btc from p2wsh", async () => {
    const derivedKeys_testnet_local = getDerivedKeysFromMnemonic(
      {
        mnemonic,
        network: "testnet",
        addressType: "p2wpkh",
      },
      3,
    );
    const pubkeys_testnet_local = derivedKeys_testnet_local.map((key) =>
      Buffer.from(key.publicKeyHex, "hex"),
    );
    const p2ms = payments.p2ms({
      pubkeys: pubkeys_testnet_local,
      m: pubkeys_testnet_local.length - 1,
      network: networks.testnet,
    });
    const p2wsh = payments.p2wsh({ redeem: p2ms, network: networks.testnet });
    const p2wsh_address = p2wsh.address!;
    const p2wshContext = {
      address: p2wsh_address,
      output: p2wsh.output!,
      witnessScript: p2ms.output!,
    };
    console.log("p2wsh_address", p2wsh_address);

    // 100-1000 sats 随机金额
    const amountSats = BigInt(Math.floor(Math.random() * 900) + 100);
    const to_address = process.env.TESTNET_TO_ADDRESS!;

    const shouldBroadcast =
      (process.env.TESTNET_BROADCAST ?? "").trim() === "1";

    // 选择 UTXO：始终自动从接口拉取并挑一个够用的最大 UTXO（不要求任何 UTXO env 配置）
    let utxos: Utxo[];
    try {
      utxos = await fetchUtxos(p2wsh_address);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const strict =
        (process.env.TESTNET_STRICT_BROADCAST ?? "").trim() === "1";
      if (shouldBroadcast && strict) {
        throw new Error(`自动拉 UTXO 失败（已开启广播且严格模式）：${msg}`);
      }
      console.log(
        `跳过：自动拉 UTXO 失败${shouldBroadcast ? "（广播未执行）" : ""}：${msg}`,
      );
      return;
    }
    if (utxos.length === 0) {
      throw new Error(`地址没有可花费 UTXO：${p2wsh_address}`);
    }
    utxos.sort((a, b) => b.value - a.value);
    // 先用占位费（会在拿到 vsize 后回算真实 fee）
    const feePadding = 200n;
    const need = amountSats + feePadding + 1n; // 至少要覆盖 amount+fee(占位)
    const picked = utxos.find((u) => BigInt(u.value) >= need) ?? utxos[0];

    const targetUtxo = {
      txid: picked.txid,
      vout: picked.vout,
      valueSats: BigInt(picked.value),
    };

    let feeRate: number;
    try {
      feeRate = await fetchFeeRateSatPerVb();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const strict =
        (process.env.TESTNET_STRICT_BROADCAST ?? "").trim() === "1";
      if (shouldBroadcast && strict) {
        throw new Error(`自动拉费率失败（已开启广播且严格模式）：${msg}`);
      }
      // 兜底费率：避免仅因费率接口失败导致无法构造 rawtx
      feeRate = 2;
      console.log(`费率接口失败，使用兜底 feeRate=5 sat/vB：${msg}`);
    }

    const key0 = ECPair.fromPrivateKey(
      Buffer.from(derivedKeys_testnet_local[0].privateKeyHex, "hex"),
      { network: networks.testnet },
    );
    const key1 = ECPair.fromPrivateKey(
      Buffer.from(derivedKeys_testnet_local[1].privateKeyHex, "hex"),
      { network: networks.testnet },
    );
    const key2 = ECPair.fromPrivateKey(
      Buffer.from(derivedKeys_testnet_local[2].privateKeyHex, "hex"),
      { network: networks.testnet },
    );
    const participants = [
      { name: "user0", keyPair: key0, keyInfo: derivedKeys_testnet_local[0] },
      { name: "user1", keyPair: key1, keyInfo: derivedKeys_testnet_local[1] },
      { name: "user2", keyPair: key2, keyInfo: derivedKeys_testnet_local[2] },
    ];
    console.log(
      "multisig participants",
      participants.map((p) => ({
        name: p.name,
        address: p.keyInfo.address,
        pubkey: p.keyInfo.publicKeyHex,
      })),
    );

    // 先判断有无找零，算出最终手续费，之后只发起一轮远端签名
    const feeWithChange = BigInt(
      Math.ceil(
        estimateVsizeWithDummySigs(
          buildUnsignedPsbt({
            targetUtxo,
            p2wsh: p2wshContext,
            toAddress: to_address,
            amountSats,
            withChange: true,
          }),
        ) * feeRate,
      ),
    );
    const hasChange = targetUtxo.valueSats - amountSats - feeWithChange > 0n;
    const finalFeeSats = hasChange
      ? feeWithChange
      : BigInt(
          Math.ceil(
            estimateVsizeWithDummySigs(
              buildUnsignedPsbt({
                targetUtxo,
                p2wsh: p2wshContext,
                toAddress: to_address,
                amountSats,
                withChange: false,
              }),
            ) * feeRate,
          ),
        );
    const { psbt, change } = await buildPsbt({
      feeSats: finalFeeSats,
      targetUtxo,
      amountSats,
      toAddress: to_address,
      p2wsh: p2wshContext,
      participants,
    });

    const tx = psbt.extractTransaction();
    const rawtx = tx.toHex();
    const txid = tx.getId();
    const actualFeeSats =
      targetUtxo.valueSats -
      tx.outs.reduce((sum, out) => sum + BigInt(out.value), 0n);
    const actualVsize = tx.virtualSize();
    const actualFeeRate = Number(actualFeeSats) / actualVsize;

    console.log("withdraw:", {
      feeSats: actualFeeSats.toString(),
      feeRate: actualFeeRate.toFixed(2),
      txid,
    });

    if (shouldBroadcast) {
      const broadcastUrl =
        process.env.TESTNET_BROADCAST_URL ??
        "https://mempool.space/testnet/api/tx";
      const res = await fetch(broadcastUrl, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: rawtx,
      });
      const txt = (await res.text()).trim();
      if (!res.ok) {
        throw new Error(`广播失败 ${res.status} ${res.statusText}: ${txt}`);
      }
      console.log("broadcasted_txid", txt);
      console.log("explorer", `https://mempool.space/testnet/tx/${txt}`);
    }

    expect(tx.ins.length).toBe(1);
    expect(tx.outs.length).toBe(change > 0n ? 2 : 1);
  });
});

// npm run test test/create.spec.ts
