# 普通钱包注册已完成：真实链上证据

2026-09-05，通过本地 `/register` 向导和专用 OKX 钱包，完成 ENSv2 Sepolia 普通 EOA 注册。不是官网 HCA/Smart Sessions 流程，不是本地模拟。

## 验证结果

- 链：Sepolia，11155111。
- 名称：`relaydesk2026.eth`。
- Owner：`0xfcb9A5c53EaD436643A46c91B24EaD3E8C0Aac68`（比赛钱包 EOA）。
- Resolver：`0xE3987444ace129a21e1C44f782292Da0BC73241E`。
- Factory 返回的实现：`0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e`（官方 PermissionedResolver）。
- Owner 的 root roles：`5444517870735015415413993718908291383312`，精确等于 `(1 << 132) | (1 << 4)`，即 TEXT 与 TEXT_ADMIN。
- 注册器剩余 MockUSDC allowance：`0`，未留下本次注册的多余额度。
- 注册回执：success，区块 `11637282`。
- 独立 RPC 回读时间：`2026-09-05T01:50:50.591Z`（10:50 JST）。

## 四笔实际交易

| 步骤 | Sepolia 交易 |
| --- | --- |
| 部署 Resolver | [0x3f514d…01f1b6](https://sepolia.etherscan.io/tx/0x3f514daa04917b13a37731f2ed60c59f416ebe6aea43ece36df6e006eb01f1b6) |
| 提交预约 commit | [0x6eafec…7224be](https://sepolia.etherscan.io/tx/0x6eafecde269fdf4b8e3dc211089b968fea5197b30e35f58316d3ac8faf7224be) |
| 精确额度 approve | [0x99b9c4…25b1b](https://sepolia.etherscan.io/tx/0x99b9c4fb1cd339098adee47ea5a45d6b8a4491c643be218d439ee1a61f425b1b) |
| 完成 register | [0x587d19…de50b4](https://sepolia.etherscan.io/tx/0x587d195db54aed07b5676ec872a36391ec334c3a8ed46670b95f9006d5de50b4) |

注册费用 `8.000021` MockUSDC，原始单位 `8000021`；测试币合约为 `0x768f42455a2d082e23ceef7d51e5787c82d67a39`，授权接收方仅官方注册器 `0xa88553f454b77203b0d036a05c894d555eaaa2cc`。没有签署无限额度授权、智能会话或主网交易。账户此前已有足够 MockUSDC，因此本轮跳过 mint。

四笔成功回执累计网络费：`0.001027353414134934` Sepolia ETH，来自免费测试币；不是主网支出。

每一笔先模拟并检查钱包显示的网络、目标与 calldata；收到匹配回执后再核对链上效果。最终注册确认发生在用户继续消息前后，记录只声明该交易已提交并验证，不把未观察到的点击归属于代理。

## 工程与安全审查

- Node 24 自动测试：152/152 通过；语法检查通过；npm audit 未报告已知漏洞。
- 使用 security-review 流程的独立审查，修复了 Resolver 与部署计划未绑定、跨标签页重复发送、等待锁期间钱包变化、成功回执但实际效果未确认等问题。
- 注册计划随机数和待处理交易保存在浏览器，不读取或导出钱包私钥。未知发送状态保持锁定，防止盲目重发。
- Factory ABI 的实际 `verifyContract(address)` 返回实现地址；没有照抄不匹配的双参数布尔文档示例。

## 下一里程碑

注册前置阻碍已经解除。仍需以独立志愿者测试账户完成真实的授权 → 修改链接 → 撤销 → 拒绝越权修改，并留下交易及只读拒绝证据。此文档不宣称整个比赛成品已经完成。
