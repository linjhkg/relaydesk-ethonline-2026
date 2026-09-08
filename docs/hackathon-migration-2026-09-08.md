# 本届专用部署迁移

> 后续验收已完成：见 `hackathon-e2e-2026-09-08.md`。下方“只读验证/后续”是迁移初始阶段记录；现在已有本届8笔成功交易和单活动闭环。双活动对照仍未完成。

原 `docs/registration-complete.md`、`docs/handover-e2e.md` 和 evidence JSON 保留为历史真实交易，不是本届专用部署的验收。

已修正：
- 五个注册/Resolver 合约地址与专用 Universal Resolver `0xd26f2040d083af1cd2962ba303f4bea0c4faf142`。
- 官方部署已验证完整 ABI，见 `src/abi/README.md`。
- Grant[] 初始化；DNS bytes setText；grantSetterRoles/revokeRoles；root/key 两种作用域；拒绝未知/旧实现及扩大权限的账户。
- 前端固定交易目标和本地存储命名空间，旧预约/发送记录不删、不自动复用。
- 页面与待签名摘要明确实例级权限，不声称按名称隔离；旧链上证据明确标注不算本届。

只读验证（2026-09-08T03:02:45Z）：
- 本届 Registrar 查询 relaydesk2026.eth 可注册，钱包在本届 MockUSDC 余额为0。
- 报价 8.000021 MockUSDC，min commitment age 60秒。
- mint 和新 Factory + 新 Grant[] 的部署 eth_call 成功。
- 专用 UR 查询当前仍没有 Resolver；这不是已经注册。

后续必须重新注册、授权/编辑/撤销/拒绝及双活动隔离验收。模拟通过与单元测试不代表链上已执行。没有主网资金交易。
