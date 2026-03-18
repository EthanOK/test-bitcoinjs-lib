# test-bitcoinjs-lib

一个最小 TypeScript Node 项目模板。

## 脚本

- `npm run dev`：直接运行 `src/index.ts`
- `npm run build`：编译到 `dist/`
- `npm start`：运行编译产物

## 从 .env 读取助记词并派生地址

1) 复制环境变量模板并填写助记词：

- 复制 `.env.example` 为 `.env`
- 修改 `.env` 里的 `MNEMONIC=...`

2) 运行：

- `npm run dev`

默认会输出 `path/address/pubkey`，不会输出私钥。若确实需要打印私钥，将 `.env` 里的 `PRINT_PRIVATE_KEY` 设为 `true`（注意安全风险）。
