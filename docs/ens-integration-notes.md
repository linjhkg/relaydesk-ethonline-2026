# ENSv2 接入证据与下一步

2026-09-05 开赛后独立官方文档研究。以下是文档核对，不是本项目已经完成的链上测试。

## 最小权限闭环

官方 Permissioned Resolver 已提供：

```solidity
authorizeTextRoles(bytes toName, string key, address account, bool grant)
    external returns (bool)
setText(bytes32 node, string key, string value) external
text(bytes32 node, string key) external view returns (string)
```

`authorizeTextRoles` 使用 DNS 编码的名称；`setText` 使用 namehash，不可以混用。组织者给志愿者 `key = url, grant = true`，志愿者更新 `url`，组织者用 `grant = false` 撤销。每次写前重新解析 resolver，不能把 PermissionedResolverImpl 的部署地址当成名称实际使用的 resolver proxy。

撤销单键权限后还必须检查志愿者没有更高范围的 root/name 角色，否则“撤销后必定拒绝”这个承诺不成立。必须增加尝试写 `description` 的负向测试。

来源：[官方 Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/)、[EAC](https://docs.ens.domains/ensv2/enhanced-access-control/)、[固定版本 ABI](https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/PermissionedResolverImpl.json)。

## 客户端和依赖决策（尚未安装）

官方 ENSv2 读取支持：viem >= 2.35.0，ENSjs >= 4.2.3。研究时 npm viem latest 为 2.56.3，ENSjs stable 为 4.3.1；版本需在安装当天复查。建议仅 viem 配合官方 ABI，不引入还在预览的 ENSjs v5 写接口。不自行实现 Keccak/namehash/交易密码学。

本地第一里程碑保持零依赖；新增 SDK 尚未执行，须符合用户的依赖授权约定。官方兼容性测试名 `ur.integration-tests.eth` 和 `test.offchaindemo.eth` 是公开读取测试，不是我们的名字，也不能假定 Sepolia 有相同记录。

来源：[官方兼容表](https://docs.ens.domains/web/ensv2-readiness/)、[应用开发教程](https://docs.ens.domains/ensv2/tutorial-app-developers/)。

## 真正接入需要做的事情

1. 准备组织者和志愿者两个隔离测试账户，仅 Sepolia 测试币；用户自己持钥、自己签名。
2. 核实 [Sepolia 最新部署](https://docs.ens.domains/learn/deployments/)。为组织者部署个人 Permissioned Resolver proxy，并正确保留 text 管理角色。
3. 注册自有测试名并指向该 resolver。注册使用免费 MockUSDC 和 Sepolia ETH，commit/register 等待时间及报价读合约，不写死。第一轮可以先一个测试名，子名创建放后续。
4. 实测未授权失败 → 授权 → 写 url 成功 → 越权写 description 失败 → 撤销 → 再写 url 失败。
5. 公开解析同一个名称，展示报名链接改变但入口名不变。保存交易哈希和错误证据。

当前未调用上述写接口、未注册名字、未部署 proxy，也未实测 RPC。仅有本地模型不能宣称满足 [ENSv2 赛道资格](https://ethglobal.com/events/ethonline2026/prizes/ens)。
