# 第一里程碑验证记录

验证日期：2026-09-05 JST。记录实际证据，不将模拟当作链上结果。

## 自动化

执行 Node `/Users/liuke241/.local/node/node-v24.14.1-darwin-arm64/bin/node`（v24.14.1）：

- `node --test`：17/17 通过。
- `npm run check`：服务、权限模型、浏览器模块语法检查通过。
- `git diff --check`：无空白错误。
- 第三方依赖：0。

覆盖：完整交接、授权前/撤销后/第三者写入拒绝、非组织者授权撤销拒绝、错误键、HTTPS URL 验证、失败不改变状态、重复授权幂等、跨站请求阻止、Host 重绑定阻止、静态文件允许列表、JSON 错误、RPC 错网与缺失代码拒绝。

只读审阅另测了超长及流式请求，8193 字节和更长请求返回 413，服务保持可用。已修复请求等待期间输入框仍可编辑导致新草稿被响应覆盖的问题。

## 浏览器实际操作

地址：http://127.0.0.1:4317 。在 Codex 内置浏览器实际点击，非只靠代码推断。

1. 负责人点击授权，界面显示成功。
2. 切换志愿者，保存 `https://example.org/relaydesk-live-demo`，预览 href 同步为新值。
3. 切回负责人撤销，版本变为 3、日志有三条。
4. 志愿者尝试改为 `https://example.org/rejected-change`，服务返回拒绝，版本仍是 3，预览 href 仍为上次成功值。
5. 负责人尝试 `javascript:alert(1)`，服务拒绝；页面只保留未保存草稿，已确认状态不变。
6. 检查 1280px 桌面两栏与 320px 窄屏布局；修复极窄屏模拟标识换行问题；320px 下 document scrollWidth = 305，不横向溢出。
7. 浏览器捕获的 error 日志为空。已撤销临时 viewport 覆盖并保留用户可见演示标签页。

未提供设计参考图，因此不虚构截图相似度评分。尚未完成键盘/屏幕阅读器全面审核及真实手机设备测试。

## 真实 Sepolia 只读预检

命令：`node scripts/sepolia-preflight.mjs`，实际返回：

```json
{
  "checkedAt": "2026-09-04T22:19:50.175Z",
  "chainId": "0xaa36a7",
  "block": "0xb18e41",
  "PermissionedResolverImplCodeBytes": 17597,
  "VerifiableFactoryCodeBytes": 1411,
  "ETHRegistrarCodeBytes": 7497
}
```

地址来自 [ENS 官方部署表](https://docs.ens.domains/learn/deployments/)，节点为 [PublicNode Sepolia RPC](https://ethereum-sepolia-rpc.publicnode.com/)。调用只有 `eth_chainId`、`eth_blockNumber` 和 `eth_getCode`。查询的是公开合约地址，不是用户钱包。未使用密钥、未发送交易。

这个结果只证明节点响应及代码存在；未匹配运行字节码与编译产物，也不证明拥有 ENS 名字、resolver 配置正确、真实权限行为或比赛完成。

## 保留风险与未完成项

- 本地演示角色由客户端选择，绝不能作为真实身份认证使用；禁止作为公网权限服务发布。
- 本地状态在进程内存中；重启清空，多浏览器访问共享演示状态。
- 实际 Sepolia 名称注册、resolver 配置、钱包签名、ENS 读取、权限调用和交易证据均未完成。
- ENSv2 Beta 接口可能变更，真实集成前重新核对部署/ABI和 SDK 支持。
- 还没有用户需求访谈或商业收入验证。
