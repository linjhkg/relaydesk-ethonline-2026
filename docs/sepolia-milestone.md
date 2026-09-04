# 真实 Sepolia 接入里程碑

日期：2026-09-05 JST。用户明确允许比赛所需操作后执行。

## 已交付

- 锁定 `viem@2.56.3` 与 lockfile，`npm audit --omit=dev` 未报告已知漏洞。
- 官方固定 commit 的完整 Permissioned Resolver ABI（88 项）及来源记录。
- 独立 `/sepolia` 页面：真实读取、实际钱包账户、错误网络阻止、只读模拟、复核后明确发起钱包请求、链上回执状态。
- 后端只读 RPC，不持有密钥，不签名，不广播；广播只能由用户点击后交给浏览器钱包。
- 64 项 Node 24 测试通过，包括 29 项 UI/钱包边界测试。后者使用可控模拟 provider，不伪称真实钱包端到端交易测试。

## 真实只读观察

通过真实 Sepolia RPC 和 HTTP `/api/ens/inspect` 读取 `ur.integration-tests.eth`：

```json
{
  "chainId": 11155111,
  "name": "ur.integration-tests.eth",
  "resolver": "0xae66c62AcAE72098BdAc57d8E8AED53EF000b2Ba",
  "url": null,
  "bytecodePresent": true
}
```

这是官方公开测试名的镜像记录，不是我们的名字，也不是可写 ENSv2 测试夹具。读取空 url 在界面显示“尚未设置”；镜像 resolver 的写入准备返回 `UNSUPPORTED_RESOLVER`。随机未注册名返回 `NO_RESOLVER`。

内置浏览器实测读取成功；没有钱包扩展时写入按钮禁用。Chrome 中实际选择 OKX 并连接专用账户，主网状态被拦截，显式切换 Sepolia 后页面正确识别。后续官网可能提出其他网络请求，发送前仍由程序实时核对。

## 免费测试币（已核对真实回执）

通过已登录的 [ETHGlobal 官方 Sepolia 水龙头](https://ethglobal.com/faucet/sepolia-11155111-eth) 领取给已验证的比赛钱包；没有更换收款地址，没有购买或跨链。

- 数量：0.05 Sepolia ETH（无市场价值的测试币，不是收入）。
- [领取交易](https://sepolia.etherscan.io/tx/0x437f5531ea4decbc23fe88781dd57eb48287e8fa851015a04856159a4cfd429e)
- RPC 回执：success，区块 11636424。
- RPC 交易值：0.05；接收地址匹配已连接比赛钱包；查询时测试余额为 0.05。
- 未由我们发送任何主网交易或签名。

## Claude 的交叉审阅

Claude 桌面同一新会话独立调查官方注册页、ABI 和源码，并写 `claude-setup-guide.md`。Codex 要求把“官方页面必走 HCA”的推断降为待验证，标清注册向导按钮尚未实现，并纠正角色与 tokenId 的描述。不要把 Claude 的建议直接当作已验证链上事实。

目前官方 ENS App 已连接比赛钱包；在它要求登录签名时，Scam Sniffer 显示安全检查。Codex 没有点击该检查的“继续”，没有看到最终钱包签名全文，也没有签名。需用户检查该安全提示后，才能继续确认普通 OKX 账户究竟走 EOA 还是智能账户注册路径。

## 尚未完成 / 真实风险

1. 自有 ENSv2 名称注册及 resolver 配置。当前没有注册向导，不应按草案点击不存在的按钮。
2. 自有名上的真实授权→志愿者更新→撤销→只读拒绝验证；没有这些交易哈希。
3. 目前权限检查覆盖 resolver 四种资源范围及相关管理/alias/upgrade 角色；名字所有权、注册表旁路、任意 resolver 实现真实性未自动认证。界面和 README 均说明限制。
4. 后端关闭任意 CCIP-Read 网关请求，因此 offchain 名称不属于本轮支持范围，不静默假装解析成功。
5. 发送到钱包前会再次模拟并核对账户、chainId、resolver、calldata 和 0 ETH 值；仍不能保证区块打包前状态不变化。
6. 钱包弹窗及安全提示不自动批准；用户自持密钥。任何需要主网资产的方案不在此里程碑中执行。

这份里程碑是“真实读取与签名准备已接入”，不是“比赛成品完成”。
