# 真实双账户交接验收完成

日期：2026-09-05。结论：**注册前置及产品核心授权→编辑→撤销→拒绝闭环已在真实 Sepolia 跑通。** 不是本地角色模拟，不代表比赛已提交或获奖。

## 实际参与者与状态

- 名称：`relaydesk2026.eth`，链 ID `11155111`。
- 所有者账户 01：`0xfcb9a5c53ead436643a46c91b24ead3e8c0aac68`。
- 独立志愿者账户 02：`0xd1e7194c2f5a6503b6e9599c7a6ba4c807b90836`。
- Resolver：`0xe3987444ace129a21e1c44f782292da0bc73241e`。
- 当前公开解析的 `url`：`https://ethglobal.com/events/ethonline2026`。
- 最终志愿者的 root/name/global-key/key 四格角色均为 `0`；没有切换 Resolver 的普通或管理员旁路权限。

第二个账户通过同一专用 OKX 钱包的账户界面取得；未读取、导出或在代码中保存其助记词/私钥。两次实际编辑与管理使用了不同地址，不以所有者账户冒充志愿者。

## 真实操作与证据

注册的四笔交易和所有权证明见 [注册完成记录](registration-complete.md)。以下是后续流程：

| 操作 | 发起者 | 成功交易 |
| --- | --- | --- |
| 给独立账户发送 0.002 测试 ETH 用于 Gas | 账户 01 → 账户 02 | [0x692fdf…3ad7e4](https://sepolia.etherscan.io/tx/0x692fdfe2302fe76be29427bf833e62c2b4c81456c7af0d554c3997b45d3ad7e4) |
| 授予 `url` 单键编辑权 | 账户 01 | [0xec69c1…9579b0](https://sepolia.etherscan.io/tx/0xec69c1d670d8306b25abf372c40afed96648dd232bdc0ca1e5d21b9fd79579b0) |
| 将实际活动链接写入 `url` | 账户 02 | [0xfbecb8…140a0](https://sepolia.etherscan.io/tx/0xfbecb8180af8c0fe6360674729ad0909bcff77e532af69602bcfbf1922c140a0) |
| 撤销同一账户的 `url` 编辑权 | 账户 01 | [0xadff9b…97e760](https://sepolia.etherscan.io/tx/0xadff9bd29d3abd282280216bff5b96c542d08e0b3584263eddfe99228697e760) |

四笔回执、发送者、目标、方法选择器、数额与费用的实际 RPC 输出已保存于 [交易证据](evidence/handover-transactions.json)。所有交易均为 Sepolia，测试资产无真实货币价值；没有主网交易、无限额度授权或智能会话授权。

## 权限验证矩阵

| 阶段 | 志愿者修改 url | 修改 description | url 单键角色 | Registry 旁路 |
| --- | --- | --- | --- | --- |
| 授权前，02:14:06 UTC 检查 | 明确拒绝 | 明确拒绝 | 0 | 无 |
| 授权后，02:18:32 UTC 检查 | 预演成功 | 明确拒绝 | 0x10 | 无 |
| 实际更新后，02:26:53 UTC 检查 | 预演成功；真实 url 已更新 | 明确拒绝 | 0x10 | 无 |
| 撤销后及最终检查 | 明确拒绝；原 url 保留 | 明确拒绝 | 0 | 无 |

拒绝被识别为真实合约自定义错误 `EACUnauthorizedAccountRoles`。脚本不会把超时、RPC 故障或 ABI 错误当作“权限验证成功”。最终完整输出及原 URL 一致性核对见 [最终验收 JSON](evidence/handover-final.json)。

Chrome 中也实际用账户 02 发起了撤销后的“模拟更新链接”：界面拒绝预演，没有出现可发送交易的确认区，原记录仍为上面的活动链接。页面此时显示的拒绝是**符合预期的验收结果**，不是新的注册故障。没有为证明拒绝而发送一笔注定失败的链上交易。

## 可重复的只读检查

```sh
node scripts/live-handover-check.mjs --expect=denied
```

在重新授权后用 `--expect=allowed` 检查。参数支持不同 name、volunteer 和模拟 URL；不会签名、广播或修改链上数据。所有测试地址只是演示夹具，应用仍读取真实 RPC，不返回硬编码的成功结果。

## 已完成与后续边界

已完成：普通 EOA 注册、最小权限 Resolver、独立双账户真实交接、越权/撤销拒绝、可复现只读验收及证据保存。

尚未完成：公众可访问的演示部署、完整演示录屏、公开提交仓库整理、最终赛道材料与正式提交。尚未验证真实客户需求或商业收入；没有获奖保证。

仍保留的工程限制：这是竞赛原型，服务仅绑定 localhost。`/sepolia` 的一般入口并非针对任意陌生 Resolver 的安全认证服务；本次使用的新 Resolver 有独立的官方 Factory 及精确部署证明。链重组与长期运行恢复仍需进一步测试。
