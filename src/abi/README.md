# ENS 官方 ABI 来源

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
