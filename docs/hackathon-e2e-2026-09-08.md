# 本届专用部署真实交接验收

2026-09-08 03:34:37 UTC（12:34 JST），本届 ENSv2 单活动链上闭环通过。不是旧部署，不是本地模拟，不等于最终比赛已提交。

- 名称：relaydesk2026.eth
- Resolver：0xb5Fc7c9fE83750a40F1701B68718d9fE8E53D707
- 本届实现：0xa9d3814ab151bf6e37a427432795371a8361614e
- 本届 Universal Resolver：0xd26f2040d083af1cd2962ba303f4bea0c4faf142
- Owner：0xfcb9a5c53ead436643a46c91b24ead3e8c0aac68
- 志愿者：0xd1e7194c2f5a6503b6e9599c7a6ba4c807b90836

## 八笔真实交易

1. mint 25 MockUSDC：0x234383326cc42e86fb7ce358c3e546662fb6e0fd83957844601f9072ccf499f0
2. Factory 部署：0x1c515c4ec1856387cf5c96085f72893b64aa401747616d58c2f82898ac87b6f2
3. commit：0x36d338b157a81678c5c74019e05aa63b7e4ed8e8978c1186300aaeba2fb74114
4. 精确 approve：0x5052b1dc03f1dfce4921e23d201634abecdc6ec180b457f2b3d7625737b62972
5. register：0xc4eb086485d7b43b59009417532c1003e830e5f2d9d5c4cc5e4c1b7692ef9511
6. grantSetterRoles：0x94c8ebc02952abbf24f4440654ab7ee248c94989c13084ddb36b033b980c8b3b
7. 志愿者 setText：0x29c0c1706a740ed981ca4cb772fff67fa3ca9a8764aac6fb487a4bead6899817
8. revokeRoles：0xc9e4438148b288f665fbac402b9746bef97dc193eaf927da6585035d3febc667

所有回执均 success，所有交易都在 Sepolia，转账 ETH value 为零；注册实际花费8.000021免费MockUSDC，最后注册器allowance为零，没有无限授权或主网资金操作。

## 权限与公众回读

授权前，url/description均返回精确 EACUnauthorizedAccountRoles。授权后 root=0，url-key=0x10；url允许、description拒绝。独立志愿者成功写入 https://ethglobal.com/events/ethonline2026 。撤销后root/key都为0，url/description均被拒绝，原链接由本届UR继续解析。

注册表检查：志愿者没有名称级或root级的 SET_RESOLVER 与对应admin旁路权限。

证据：`docs/evidence/hackathon-registration-20260908.json`、`hackathon-before-grant-20260908.json`、`hackathon-after-grant-20260908.json`、`hackathon-after-revoke-20260908.json`、`hackathon-handover-transactions-20260908.json`。它们来自当前链上回执/读数，不是生成成功样例。

## 尚未完成

两个独立活动实例的对照尚未完成；不能据单活动验收宣称双实例隔离已验证。URL权限实际覆盖整个实例，不能宣称全球按名称隔离。完整公开仓库、最终真人视频、正式提交仍待完成。
