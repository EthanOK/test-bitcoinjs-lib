# test-bitcoinjs-lib

基于 **TypeScript** 的比特币示例项目，使用 [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib)、[bip39](https://github.com/bitcoinjs/bip39)、[bip32](https://github.com/bitcoinjs/bip32)、[tiny-secp256k1](https://github.com/bitcoinjs/tiny-secp256k1) 与 [ecpair](https://github.com/bitcoinjs/ecpair)，演示从助记词派生地址，以及在 **Bitcoin testnet** 上构造 **P2WSH（n-1）-of-n 多签** 的 PSBT / 提现流程（集成测试）。

## 环境要求

- **Node.js** ≥ 18

## 安装

```bash
npm install
```

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 用 ts-node 运行 `src/index.ts`（当前仅为占位输出） |
| `npm run build` | 编译到 `dist/` |
| `npm start` | 运行 `dist/index.js` |
| `npm run clean` | 删除 `dist/` |
| `npm test` | 运行 [Vitest](https://vitest.dev/) 测试 |

## 核心模块：`src/mnemonic.ts`

在应用入口或其它模块中初始化 ECC 后，再调用本模块（与测试一致：`initEccLib` 使用 `tiny-secp256k1`）。

### 导出类型

- **`BtcAddressType`**：`"p2pkh"` | `"p2wpkh"` | `"p2tr"`
- **`BtcNetwork`**：`"mainnet"` | `"testnet"`
- **`DeriveFromMnemonicParams`**：`mnemonic`、可选 `passphrase`、`network`、`addressType`、`coinType`、`account`、`change`、`index`
- **`DerivedKeyInfo`**：`path`、`privateKeyHex`、`publicKeyHex`、`address`

### 函数

- **`deriveBtcFromMnemonic(params)`**  
  校验 BIP39 助记词后，从种子按 **BIP32** 派生一条路径，返回该索引下的私钥/公钥/地址。

  默认派生路径（`coinType` 默认 **0**，`account` 默认 **0**，`change` 默认 **0**，`index` 默认 **0**）：

  | 地址类型 | purpose（BIP） | 路径模板 |
  |----------|----------------|----------|
  | `p2pkh` | 44 | `m/44'/coin'/account'/change/index` |
  | `p2wpkh`（默认） | 84 | `m/84'/coin'/account'/change/index` |
  | `p2tr` | 86 | `m/86'/coin'/account'/change/index` |

  **`coinType` 说明**：不传时固定为 `0`。这样在 **testnet** 下仍与同 account/change/index 的 **mainnet** 使用同一私钥，仅网络前缀不同（如 `bc1` / `tb1`）。若需与 **Electrum testnet** 等使用 `coin_type=1` 的钱包对齐，可显式传入 `coinType: 1`。

- **`getDerivedKeysFromMnemonic(params, count?, change?)`**  
  批量派生多条 `DerivedKeyInfo`。第三个参数 `change` 为 `true` 时，会先包含 `change:0,index:0`，再为 `change:1` 生成 `count` 条（用于找零链等场景）。

无效助记词会抛出 **`无效助记词（mnemonic）`**；派生节点无 `privateKey` 时会抛出相应错误。

## 测试说明

### `test/mnemonic.spec.ts`

使用固定 BIP39 测试向量，不依赖 `.env`，验证 `deriveBtcFromMnemonic` 结果稳定且地址可由私钥复现。

### `test/create.spec.ts`

需要环境变量 **`MNEMONIC`**（加载方式与测试内 `dotenv.config()` 一致，通常放在项目根目录 `.env`）。

- 校验 **P2WPKH** 主网/测试网地址与 BIP173 行为一致。
- 由同一助记词派生多把公钥，构造 **P2WSH + P2MS（n-1）-of-n**，并与预期 bech32 地址比对。
- 异步用例：从 **mempool.space testnet** 拉取 P2WSH 地址 UTXO、推荐费率，组装 PSBT、多签提现；可通过环境变量控制是否真正广播。

建议复制 `.env.example` 为 `.env` 并按需修改：

| 变量 | 说明 |
|------|------|
| `MNEMONIC` | 测试用助记词（勿用于真实资金） |
| `TESTNET_TO_ADDRESS` | 测试提现的目标 testnet 地址 |
| `TESTNET_BROADCAST` | 设为 `1` 时在测试末尾 POST 广播原始交易（默认 `0` 仅构造与断言） |
| `TESTNET_BROADCAST_URL` | 可选，默认 `https://mempool.space/testnet/api/tx` |
| `TESTNET_STRICT_BROADCAST` | 设为 `1` 时，在开启广播的情况下若拉 UTXO/费率失败则直接失败，而不是跳过或兜底 |

单独跑集成测试示例：

```bash
npm run test test/create.spec.ts
```

## 安全提示

- 永远不要把真实主网助记词提交到仓库或写入可被他人读取的配置。
- `.env` 应已被 `.gitignore` 忽略；示例仅用于 **testnet** 与学习。

## 许可证

ISC（见 `package.json`）。
