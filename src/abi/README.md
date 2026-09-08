# ENS 官方 ABI 来源

## 当前：ETHOnline 专用部署（2026-09-08）

当前 JSON 已替换为以下 Blockscout 已验证部署的完整 `.abi`（均 `is_verified: true`，solc v0.8.25+commit.b61c2a91）。未找到可信部署 Git commit，因此不虚构 commit；下方旧 commit 仅描述历史版本。

| 文件 | 部署地址 | JSON SHA-256 |
|---|---|---|
| permissioned-resolver.json | 0xa9d3814ab151bf6e37a427432795371a8361614e | d2f16aadad7c6ed7f0da02eed34670df60009c304025a73cf3c7ada1ea65e0cf |
| eth-registrar.json | 0x7d1b7f586a62ac3f54b9a396849757814283270b | a98d5cd2d43c5157906535e35b6b4c1a4cc1f480e25fba0b24d740efde33ead4 |
| eth-registry.json | 0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e | 8d5df8733742c5a57c49479d0138538417dc08abb16810e75b9eb9376c76abb7 |
| verifiable-factory.json | 0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780 | 04c39365dbc67a1ca586af0f95c4136d974f83cb10c318c61dbebb810beb97e2 |
| mock-usdc.json | 0xcbfd80f74375c54e545af34788ff465f96f66f05 | 44343e47c2c9edfcbcc46ed8d2455fd263ca8617447af92f155e68b933c91eac |

API：`https://eth-sepolia.blockscout.com/api/v2/smart-contracts/{部署地址}`。
部署表：https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta

关键签名：initialize((address account,uint256 roleBitmap)[],bytes[])；setText(bytes,string,string)；grantSetterRoles(bytes,address)；revokeRoles(uint256,uint256,address)。Factory 仍为 verifyContract(address) returns(address)。不要用其他分支、其他 Grant 类型或旧文档示例替换本 ABI。

## 历史来源（已被上方专用部署替换）

`permissioned-resolver.json` 是官方部署产物的完整 `.abi` 数组（88项），未手写签名、未包含部署字节码或私钥。

- 源仓库：ensdomains/contracts-v2
- 固定 commit：`97a57293f3b4279d94b571e678edb53ce62638f4`
- 来源：https://raw.githubusercontent.com/ensdomains/contracts-v2/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/PermissionedResolverImpl.json
- 提取日期：2026-09-05 JST
- 相关文档：https://docs.ens.domains/ensv2/permissioned-resolver/

部署地址与实际用户 resolver 不同。写入前总是解析名称最新 resolver；实现地址不能作为名称的写入目标。

## 普通钱包注册路径（2026-09-05）

新增 eth-registrar.json、verifiable-factory.json、mock-usdc.json、eth-registry.json，均从同一官方固定 commit 的 contracts/deployments/sepolia/{ETHRegistrar,VerifiableFactory,MockUSDC,ETHRegistry}.json 中机械提取完整 ABI。

**接口差异：实际 VerifiableFactory ABI 为 verifyContract(address proxy) returns (address implementation)**，并非当前部分文档示例里的双参数布尔函数。实现以实际部署产物及只读链上验证为准。
