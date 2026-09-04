# ENS 官方 ABI 来源

`permissioned-resolver.json` 是官方部署产物的完整 `.abi` 数组（88项），未手写签名、未包含部署字节码或私钥。

- 源仓库：ensdomains/contracts-v2
- 固定 commit：`97a57293f3b4279d94b571e678edb53ce62638f4`
- 来源：https://raw.githubusercontent.com/ensdomains/contracts-v2/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/PermissionedResolverImpl.json
- 提取日期：2026-09-05 JST
- 相关文档：https://docs.ens.domains/ensv2/permissioned-resolver/

部署地址与实际用户 resolver 不同。写入前总是解析名称最新 resolver；实现地址不能作为名称的写入目标。
