# Claude 接入指南：从 OKX 测试钱包到自有 ENSv2 名字 + Permissioned Resolver

- 首版 2026-09-05 约 07:5x JST；本版修订：2026-09-05 07:52 JST（系统 `date`）
- 维护者：Claude 只维护本文件。`src/`、`server.mjs`、`public/`、`test/` 由 Codex 负责
- 方法：只读浏览公开界面（app.ens.dev、explorer.ens.dev）、读取官方文档与官方仓库固定 commit 源码与 ABI。未连接钱包、未发交易、未读旧目录
- 所有地址均取自官方地址表 https://docs.ens.domains/learn/deployments/ （2026-09-05 核对）。官方提示 Sepolia 名字与状态"可能因例行合约部署而周期性重置，最近一次部署为 2026-07-30"
- 本文严格区分三类内容：**[事实]** 有源码、ABI、官方文档或链上交易佐证；**[推断]** 由公开 JS 包或间接证据得出、未实际连钱包验证；**[策略]** 我们自己的保守选择，不是合约行为

## 0. 结论

**[事实]** 我们需要的机制存在：组织者拥有的 Permissioned Resolver 实例上，`authorizeTextRoles(dnsName, "url", volunteer, grant)` 可按 key 授权与撤销。

**[推断]** app.ens.dev 当前默认注册路径把名字 owner 与 resolver admin 设为一个 Rhinestone "Standalone HCA" 智能账户，而不是签名的 EOA。同时它的 JS 包里存在非 Rhinestone 分支（签名者不是 Rhinestone 时直接进入 `deployingResolver`，并以 EOA 作 owner 构造 `register`）。**哪条分支对注入的 OKX 钱包生效，我没有验证。** Codex 将在实际连接 OKX 后查看真实注册页并回填结论（见 2.3 的判定清单）。

**[策略]** 在 2.3 的判定完成前，不断言"必须自写注册"。两条路径都保留：
- 路径 A：app.ens.dev 注册后若判定为 EOA 拥有，则我们只需做业务三笔交易，前置全部由官方 App 处理
- 路径 B：判定为 HCA 拥有或无法确认，则由我们自己从 EOA 发前置交易（第 3 节的调用序列），这部分**目前尚未实现**

**Codex 现在就能做、不需要用户签名的工作**：
- `inspect`：只读检查名字 owner、当前 resolver、四格角色、alias、registry 角色（第 4 节清单）
- `prepare`：为已确认的调用生成 calldata、金额与预测地址
- `receipt`：解析 `ProxyDeployed`、注册与授权回执
- 用公开名字做只读验证：explorer 上今天注册的 `accouple.eth`，resolver 为 `0x721A0C5F3B59B2135Ba71eF92d5cFc66347EefD4`，可对它调 `roles()` / `hasRoles()` / `getAlias()` 验证资源公式
- `eth_call` 模拟撤销后 `setText` 的 revert

## 1. 官方出处

- 赛道：https://ethglobal.com/events/ethonline2026/prizes/ens
- ENSv2 总览（提到 ENS Explorer 是 Sepolia 试用入口）：https://docs.ens.domains/ensv2/overview/
- ETH Registrar（commit/register、60 秒、24 小时、ERC20 授权）：https://docs.ens.domains/ensv2/eth-registrar/
- 应用开发教程（MockUSDC mint 无访问控制；每次写前重新解析 resolver）：https://docs.ens.domains/ensv2/tutorial-app-developers/
- Verifiable Factory（`deployProxy`、salt、`initialize`）：https://docs.ens.domains/ensv2/verifiable-factory/
- Permissioned Resolver（四格检查、alias 只经 Universal Resolver 生效、`ROLE_SET_ALIAS` 仅 root）：https://docs.ens.domains/ensv2/permissioned-resolver/
- Enhanced Access Control：https://docs.ens.domains/ensv2/enhanced-access-control/
- Permissioned Registry：https://docs.ens.domains/ensv2/permissioned-registry/
- 地址表：https://docs.ens.domains/learn/deployments/
- 固定 commit `97a5729` 源码与 ABI：
  - https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/PermissionedResolverImpl.json
  - https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/ETHRegistrar.json
  - https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/ETHRegistry.json
  - https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/MockUSDC.json
  - https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/src/resolver/PermissionedResolver.sol
  - https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/src/resolver/libraries/PermissionedResolverLib.sol
  - https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/src/access-control/EnhancedAccessControl.sol
- 公开界面：https://app.ens.dev （注册页需连钱包才能看到后续步骤）、https://explorer.ens.dev （名字页有 Owner / Resolver / Roles / Records / Ownership 标签）

## 2. app.ens.dev 实际做了什么

### 2.1 核查方式

不连钱包，搜索测试名进入注册页；页面停在 "CONNECT TO REGISTER"，显示 1/3/6 年价格（5 字符以上约 8.01 美元/年，"Stables accepted"）。随后在页面内检索其公开 JS 包中的字符串，并用 explorer 与 Sepolia 浏览器核对今天一笔真实注册。

### 2.2 观察到的内容

**[事实，来自 JS 包字符串]** 注册状态机：`computingHcaBudget → checkingHcaFunding → signingFundingPermit → submittingSetupBundle → waitingForCommitment → fetchingCommitmentAge → commitmentCooldown → validatingCommitment → checkingAllowance → approvingToken → waitingForApproval → registeringDomain → (可选) settingPrimaryName`。状态机入口有分支：`isRhinestoneSigner` 为真进入 `computingHcaBudget`，否则直接进入 `deployingResolver`。

**[事实，来自 JS 包字符串]** HCA 分支会在同一 bundle 内：`deployProxy(permissionedResolverImpl, salt, initialize(hca, ALL_ROLES, []))`，salt = `keccak256(abi.encode(keccak256("OwnedResolver"), owner, 0))`，`ALL_ROLES = 0x1111…1111`（64 个 1）；若地址已有代码则跳过部署；预测地址直接作为 `register` 的 `resolver` 参数；`subregistry = 0x0`、`referrer = 0x0`、payment token = MockUSDC；secret 固定为 `0x2222…22`。

**[事实，来自 JS 包字符串]** 包中没有用户可见的 MockUSDC 领取入口。唯一的 `mint(to, amount)` 调用位于 anvil 本地测试辅助（`mode: 'anvil'`、`setCode`）。余额不足时报 "Insufficient USDC to fund the registration"。

**[事实，链上]** 今天 explorer 上新注册的 `accouple.eth`，Sepolia 交易 `0x76a0dd03…9ddb87` 的 To 为 `0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF`，方法 `executeSinglechainOpsWithGasRefund_ERC20`，带 `IntentExecuted` 事件。这一笔走的是意图执行路径。

**[推断]** 由上述三点推断默认路径是 HCA，名字 owner 不是签名的 EOA。一笔样本不能证明所有钱包类型都如此，非 Rhinestone 分支的触发条件我没有验证。

### 2.3 连接 OKX 后要回答的问题（Codex 执行）

1. 注册页是否出现"创建智能账户 / 会话 / 用 USDC 付 gas"之类提示，或直接请求 EOA 签名的 `deployProxy`？
2. 注册完成后：`ETHRegistry.ownerOf(findTokenId(label))` 是否等于 OKX 地址？
3. `eth_getCode(owner)` 是否为空？
4. 在 `ETHRegistry.getResolver(label)` 返回的 resolver 上，`hasRootRoles(ROLE_SET_TEXT_ADMIN, okxAddress)` 是否为真？

2 至 4 全为真则路径 A 可用。任一为假则名字由 HCA 控制，接入需要 Rhinestone SDK 与会话签名，超出本轮范围，改走路径 B。

## 3. 路径 B 的前置调用序列（尚未实现，供 prepare 端设计）

**[事实]** 以下签名均来自固定 commit ABI 与官方文档。**[策略]** 这是我们自己的调用编排，不是官方规定顺序。

| 步骤 | 合约 | 调用 | 说明 |
|---|---|---|---|
| 0 | 无 | 领 Sepolia ETH | 用户自取。ETHGlobal 官方已提供 0.05 Sepolia ETH 领取 |
| 1 | MockUSDC `0x768f42455a2d082e23ceef7d51e5787c82d67a39` | `mint(address to, uint256 amount)` | 官方原文："its `mint` function has no access control, so anyone can mint themselves a balance" |
| 2 | VerifiableFactory `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` | `deployProxy(address implementation, uint256 salt, bytes data)`，data = `initialize(address admin, uint256 roleBitmap, bytes[] setters)` | 实例地址从回执 `ProxyDeployed` 事件读取，或按 CREATE2 预测 |
| 3 | ETHRegistrar `0xa88553f454b77203b0d036a05c894d555eaaa2cc` | `commit(bytes32)`，commitment = view `makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer)` | secret 随机生成并本地保存 |
| 等待 | 无 | 至少 `MIN_COMMITMENT_AGE()`，不超过 `MAX_COMMITMENT_AGE()` | 文档写 60 秒与约 24 小时；ENS App 界面按约 70 秒等待 |
| 4 | MockUSDC | `approve(address spender, uint256 value)` | 金额 = `getRegisterPrice(string label, uint64 duration, address paymentToken)` 返回的 base + premium |
| 5 | ETHRegistrar | `register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer)` | owner = EOA，resolver = 第 2 步实例，则无需再 `setResolver` |

路径 B 用户共签 5 次（已持 MockUSDC 则 4 次）。之后业务三笔：授权、志愿者 `setText`、撤销。拒绝用 `eth_call`。志愿者不需要名字，只需要 Sepolia ETH。

其他参数事实：
- `MIN_COMMITMENT_AGE`、`MAX_COMMITMENT_AGE`、`MIN_REGISTER_DURATION` 都是 view，读链上值
- MockUSDC 小数位由构造函数 `decimals_` 决定，ENS App 测试辅助按 6 位处理；适配器读 `decimals()`
- `initialize` 源码：`_grantRoles(ROOT_RESOURCE, roleBitmap, admin, false); multicall(setters)`，`setters` 绕过权限检查，我们传空数组
- 注册后 owner 获得 registry 角色 `ROLE_SET_SUBREGISTRY, ROLE_SET_RESOLVER, ROLE_CAN_TRANSFER_ADMIN` 及 admin 变体（eth-registrar 文档）
- 官方表 `UniversalResolverV2 = 0x4a1817d13e9cf196f471725176355c1234b63c70`，ENS App 包内写的是 `0x5a9236e72a66D3e08B83dcf489B4d850792B6009`，两者不一致。读取走 viem 链配置或库解析，不固定实现地址
- 注册错误名：`CommitmentTooNew`、`CommitmentTooOld`、`DurationTooShort`、`NameNotAvailable`、`UnexpiredCommitmentExists`

## 4. 适配器必须检查的更宽权限

前提：**ABI 里存在某个函数不等于我们已经验证了它的语义**。每一项都要有在 Sepolia 上跑通的只读测试。

### 4.1 合约事实（固定 commit 源码）

- `ROOT_RESOURCE = 0`（EnhancedAccessControl.sol）。适配器直接调 `ROOT_RESOURCE()` 读链上值
- `resource(node, part) = keccak256(node ‖ part)`（各 32 字节），`node == 0 && part == 0` 时返回 0
- `partHash(key) = keccak256(bytes(key))`
- setter 修饰器 `onlyPartRoles`：先看 `hasRoles(resource(node, part))` 或 `hasRoles(resource(0, part))`，都不满足则 `_checkRoles(resource(node, 0))`。`hasRoles` 内部 `_effectiveRoles = roles(ROOT) | roles(resource)`，root 在每一格里都被并入。这就是"四格"
- **角色按类型限定**：root 上的 `ROLE_SET_ADDR` 不会赋予 `ROLE_SET_TEXT`。真正能覆盖"url 单 key 撤销"的，只有在 root、`(0, part)`、`(node, 0)` 三格中任一格持有的 `ROLE_SET_TEXT` 本身
- `roles(resource, account)` 只返回该资源自身位图，不并入 root；`hasRootRoles` 只看 root。判断"授在哪一格"要用 `roles()`
- `authorizeTextRoles(grant=true)` 的调用者检查是 `_checkCanGrantRoles(resource(node, 0), ROLE_SET_TEXT, msg.sender)`，即在 `(node, 0)` 或 root 持有 `ROLE_SET_TEXT_ADMIN`（`1 << 4 << 128`）。撤销走 `_checkCanRevokeRoles`，同一资源。**该函数不检查 key 级资源上的 admin 位**，所以仅在 `(node, part)` 持有 `ROLE_SET_TEXT_ADMIN` 的账户，按源码无法通过 `authorizeTextRoles` 给自己再授权。通用 `grantRoles(resource, …)` 是否允许它在 key 级资源上自授，我没有逐行核对
- 单格撤销不触碰 root 上的同一角色：`grantRoles / revokeRoles` 拒绝 `ROOT_RESOURCE`，root 要走 `revokeRootRoles`
- revert `EACUnauthorizedAccountRoles(resource, roleBitmap, account)` 中的 resource 是 `resource(node, 0)`，不是 key 级资源。界面解释 revert 时不要误标

### 4.2 授权前与撤销后对志愿者 V 的检查（在名字当前 resolver 上）

设 `node = namehash(name)`、`part = partHash("url")`，四格：`root = 0`、`anyNameThisKey = resource(0, part)`、`thisNameAnyKey = resource(node, 0)`、`thisNameThisKey = resource(node, part)`。

| 检查 | 授权前 | 授权后 | 撤销后 | 说明 |
|---|---|---|---|---|
| `roles(root, V)` | 0 | 0 | 0 | **[事实]** 其中的 `ROLE_SET_TEXT` 位会覆盖单 key 撤销；`ROLE_UPGRADE`、`ROLE_CLEAR`、`ROLE_SET_ALIAS` 各有独立危害。**[策略]** v1 不区分位，任何非零一律拒绝 |
| `roles(anyNameThisKey, V)` | 0 | 0 | 0 | 同上，`ROLE_SET_TEXT` 位意味着能改所有名字的 url |
| `roles(thisNameAnyKey, V)` | 0 | 0 | 0 | 同上，`ROLE_SET_TEXT` 位意味着能改这个名字的所有记录 |
| `roles(thisNameThisKey, V)` | 0 | 恰好 `ROLE_SET_TEXT` | 0 | **[策略]** 高 128 位非零一律拒绝。按 4.1 源码，key 级 admin 位不能经 `authorizeTextRoles` 自授；保守拒绝是策略，不是已证明的攻击 |
| `hasRoles(thisNameThisKey, ROLE_SET_TEXT, V)` | false | true | false | 授权后为 true 且四格 `roles()` 符合上表，才证明离线资源公式与链上一致 |

判定规则 **[策略]**：授权前任何一格非零，界面拒绝发起授权并说明原因。撤销后任何一格非零，界面标红"撤销未生效"。

### 4.3 组织者 O 的检查（授权按钮出现之前）

- owner：ABI 中 `ownerOf(uint256 tokenId)` 只接受 tokenId，且 tokenId 会随重注册变化。正确调用：`tokenId = ETHRegistry.findTokenId(string label)`，再 `ETHRegistry.ownerOf(tokenId)`，应等于 O；`latestOwnerOf(uint256 tokenId)` 在过期后仍返回记录的 owner。`eth_getCode(O)` 应为空（O 是 EOA）
- resolver：`ETHRegistry.getResolver(string label)` 非零，每次写前重新读取；授权与 `setText` 目标必须是这次读到的地址
- 在该 resolver 上 `hasRoles(resource(node, 0), ROLE_SET_TEXT_ADMIN, O)` 为真，否则 `authorizeTextRoles` 必 revert
- `getAlias(bytes fromName)` 传 DNS 编码名字，返回应为空。若非空，志愿者对 `node` 的写入经 Universal Resolver 读不到
- `getAssigneeCount(thisNameThisKey, ROLE_SET_TEXT)` 小于 15，否则 `EACMaxAssignees`

### 4.4 registry 层的旁路

resolver 上的检查不覆盖 registry。志愿者若在 ETHRegistry 上持有该名字的 `ROLE_SET_RESOLVER`（`1 << 24`）或 registry root 上的同一角色，可以把名字指到自己控制的 resolver。检查：
- `ETHRegistry.hasRoles(uint256 anyId, uint256 roleBitmap, address account)`：anyId 可传 `findTokenId(label)`，roleBitmap = `ROLE_SET_RESOLVER`，account = V，应为假
- `ETHRegistry.hasRootRoles(ROLE_SET_RESOLVER, V)` 应为假
- 名字重注册会递增 `eacVersionId`，旧的 registry 权限自动失效，但 resolver 上的角色不会随之失效。名字过期重注册后要重跑 4.2 全部检查

### 4.5 alias 的影响

- `setText` / `text` 直接按传入 `node` 读写，alias 只在 `resolve()` 路径改写。explorer 或 viem 经 Universal Resolver 看到的值可能来自别的名字
- `ROLE_SET_ALIAS` 是 root-only 角色。4.2 第一行为 0 则志愿者不能设 alias；组织者自己设了 alias 会让演示失真，所以 4.3 也查

### 4.6 环境层

- Sepolia 状态会周期性重置（官方提示，最近 2026-07-30）。演示脚本要能从第 0 步重跑
- 官方原文："The contracts and interfaces described here are not yet final and may change prior to mainnet deployment"。地址与 ABI 集中在一个配置文件，标注核对日期

## 5. 待实现方案：用户操作流程草案

**本节描述的按钮目前不存在，不是当前可执行的用户操作清单。** 当前 `/sepolia` 页面已有的是只读读取、模拟、签名复核与回执功能。下面是路径 B 落地后的目标流程，供 Codex 设计界面用。

组织者（OKX 测试钱包，切到 Sepolia）：
1. 领 Sepolia ETH（已完成，ETHGlobal 官方 0.05 Sepolia ETH）
2. 待实现：领取测试 USDC，签名 `mint`
3. 待实现：部署专属 resolver，签名 `deployProxy`
4. 待实现：预约名字，签名 `commit`；页面倒计时到 `MIN_COMMITMENT_AGE`
5. 待实现：授权付款，签名 `approve`
6. 待实现：注册，签名 `register`
7. 业务：授权志愿者，签名 `authorizeTextRoles(…, true)`

志愿者（第二个测试钱包，只需 Sepolia ETH）：
8. 业务：更新报名链接，签名 `setText(node, "url", value)`

组织者：
9. 业务：收回权限，签名 `authorizeTextRoles(…, false)`
10. 页面用 `eth_call` 展示志愿者再次写入的 revert，并提示覆盖旧链接

若 2.3 判定路径 A 可用，则第 2 至 6 步由 app.ens.dev 完成，我们只做第 7 至 10 步。所有步骤只在用户点击后发起钱包请求，不自动确认，不索要私钥，不涉及主网资金。
