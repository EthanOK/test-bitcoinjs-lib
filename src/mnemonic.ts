import * as ecc from "tiny-secp256k1";
import { initEccLib, networks, payments } from "bitcoinjs-lib";
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";

initEccLib(ecc);

const bip32 = BIP32Factory(ecc);

export type BtcAddressType = "p2pkh" | "p2wpkh" | "p2tr";
export type BtcNetwork = "mainnet" | "testnet";

export type DeriveFromMnemonicParams = {
  mnemonic: string;
  passphrase?: string;
  network?: BtcNetwork;
  addressType?: BtcAddressType;
  /**
   * BIP32 派生路径中的 coin_type（比如 0=mainnet, 1=testnet）。
   * 若不传，本项目默认用 0（即使是 testnet），以保证同一助记词在相同 account/change/index 下派生出同一私钥，
   * 仅地址前缀随 network 改变（bc1... / tb1...）。
   */
  coinType?: number;
  account?: number; // BIP44/84/86 account
  change?: 0 | 1;
  index?: number;
};

export type DerivedKeyInfo = {
  path: string;
  privateKeyHex: string;
  publicKeyHex: string;
  address: string;
};

function getNetwork(n: BtcNetwork) {
  return n === "testnet" ? networks.testnet : networks.bitcoin;
}

function defaultPurpose(t: BtcAddressType) {
  if (t === "p2pkh") return 44;
  if (t === "p2wpkh") return 84;
  return 86; // p2tr
}

function toAddress(
  addressType: BtcAddressType,
  network: any,
  publicKey: Buffer,
) {
  if (addressType === "p2pkh") {
    return payments.p2pkh({ pubkey: publicKey, network }).address!;
  }
  if (addressType === "p2wpkh") {
    return payments.p2wpkh({ pubkey: publicKey, network }).address!;
  }
  // p2tr: bitcoinjs-lib expects x-only pubkey (32 bytes)
  const xOnly = publicKey.length === 33 ? publicKey.subarray(1, 33) : publicKey;
  return payments.p2tr({ internalPubkey: xOnly, network }).address!;
}

/**
 * 从助记词（BIP39）派生出单个地址对应的私钥/公钥/地址。
 *
 * 默认路径：
 * - p2pkh:  m/44'/coinType'/0'/0/0
 * - p2wpkh: m/84'/coinType'/0'/0/0
 * - p2tr:   m/86'/coinType'/0'/0/0
 */
export function deriveBtcFromMnemonic(
  params: DeriveFromMnemonicParams,
): DerivedKeyInfo {
  const networkName = params.network ?? "mainnet";
  const addressType = params.addressType ?? "p2wpkh";
  const coin = params.coinType ?? 0;
  const account = params.account ?? 0;
  const change = params.change ?? 0;
  const index = params.index ?? 0;

  if (!bip39.validateMnemonic(params.mnemonic)) {
    throw new Error("无效助记词（mnemonic）");
  }

  const net = getNetwork(networkName);
  const seed = bip39.mnemonicToSeedSync(params.mnemonic, params.passphrase);

  const purpose = defaultPurpose(addressType);
  const path = `m/${purpose}'/${coin}'/${account}'/${change}/${index}`;

  const root = bip32.fromSeed(seed, net);
  const node = root.derivePath(path);

  if (!node.privateKey) {
    throw new Error("派生结果不包含 privateKey（可能是中性节点）");
  }

  const privateKeyHex = Buffer.from(node.privateKey).toString("hex");
  const publicKey = Buffer.from(node.publicKey);
  const publicKeyHex = publicKey.toString("hex");
  const addr = toAddress(addressType, net, publicKey);

  return {
    path,
    privateKeyHex,
    publicKeyHex,
    address: addr,
  };
}

export function getDerivedKeysFromMnemonic(
  params: DeriveFromMnemonicParams,
  count = 1,
  change = false,
): DerivedKeyInfo[] {
  const keys: DerivedKeyInfo[] = [];
  if (change) {
    keys.push(deriveBtcFromMnemonic({ ...params, change: 0, index: 0 }));
  }
  for (let i = 0; i < count; i++) {
    if (change) {
      keys.push(deriveBtcFromMnemonic({ ...params, change: 1, index: i }));
    } else {
      keys.push(deriveBtcFromMnemonic({ ...params, index: i }));
    }
  }
  return keys;
}
