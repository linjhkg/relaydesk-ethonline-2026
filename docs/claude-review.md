# Claude 审阅：RelayDesk「活动链接交接台」

- 首次审阅：2026-09-05 约 07:15 JST；本版修订：2026-09-05 07:18 JST（均取自系统 `date`）
- 审阅范围：候选判断、验收标准、ENSv2 真实接入约束与官方出处、下一轮建议
- 分工：Claude 只维护本文件；`src/`、`test/`、`public/`、`server.mjs` 与联调由 Codex 负责，本文不改动它们
- 所有事实均来自下列官方页面与官方仓库在审阅当时的内容，未依赖赛前材料

## 0. 已达成的共识（2026-09-05 07:18 JST）

- v1 范围：单名字、单 text key `url`、单志愿者。子名创建与多志愿者留后续
- 本地层定位：**产品交互与行为模拟**，用于验证界面流程与负向路径。它不实现、不冒充 EAC 合约逻辑，本里程碑不自写 Keccak 资源计算、角色位图或 15 人上限。这些语义归真实适配器及其测试
- **本地模拟不能作为赛道完成**。赛道要求"built on ENSv2 (Sepolia)"且"demo must be functional and not just include hard-coded values"，模拟结果不满足任何一条。界面全程标注 SIMULATION，提交材料中必须以 Sepolia 交易为准
- 撤销不删除旧值，界面加入警告（Codex 进行中）
- 本轮不新增依赖、不发链上交易、不索要私钥。下一步接入建议用 viem，但安装须遵守用户的依赖约定
- 不再扩题

## 1. 结论：支持，v1 收窄

**支持的理由**：候选的核心机制在 ENSv2 官方文档与官方部署产物中真实存在。Permissioned Resolver 提供 `authorizeTextRoles(bytes toName, string key, address account, bool grant)`，可以把 `ROLE_SET_TEXT` 精确限定到某个名字的某个 text key，`grant=false` 即撤销。"只授权志愿者改 `url`、活动结束收回"这个故事与官方 API 一一对应，不需要自造合约，符合赛道"ENSv2 功能必须是产品核心"的要求。

**关键问题（按严重程度）**：

1. **每个账户要先有自己的 Permissioned Resolver 实例**。官方说明"每个账户获得自己的 resolver 实例，作为 UUPS 代理部署；同一账户拥有的所有名字共用一个 resolver"。这属于前置设置，无法跳过，也是"确实用了 ENSv2"的证据。
2. **子名是独立的第二个难题**。需要组织者在 Sepolia ENSv2 上持有 `.eth` 名字（ETHRegistrar 用 MockUSDC 收费），再调 `register(label, owner, registry, resolver, roleBitmap, expiry)`。与按 key 授权无关。已决定 v1 不做。
3. **谁能调用 `authorizeTextRoles` 文档没有写明**。上链前必须用 `eth_call` 模拟验证，不能假设组织者 EOA 一定能调。
4. **志愿者不能持有更宽的角色**。若志愿者在 root 层或名字层已持有 `ROLE_SET_TEXT`，撤销单个 key 的授权后仍能改链接。授权前与撤销后都要用 ABI 中的 `hasRootRoles` / `hasRoles` 检查志愿者没有 root 或名字级别的 text 角色。这是撤销真正生效的前提，属于真实适配器测试项。
5. **撤销权限不会清空记录值**。志愿者最后写入的链接在撤销后仍是当前解析值，组织者需再写一次 `url` 覆盖或清空。
6. **合约与接口未定型**。官方原文："The contracts and interfaces described here are not yet final and may change prior to mainnet deployment。"地址表可能重新部署。ABI 使用官方仓库固定 commit 的部署产物（见 3.4），不得手写。
7. **不可逆操作**。官方注明"同时撤销某角色和它的 admin 角色是不可逆的"。RelayDesk 只发放普通角色，不给志愿者任何 admin 角色（bit 128 以上）。
8. **同一资源同一角色最多 15 个账户**。v1 单志愿者不触及；多志愿者版本再处理。

### 交易结构（修正版）

之前写的"三笔交易"不准确，按下面区分：

- **前置设置（一次性，笔数取决于起点）**：若无名字则先注册（ETHRegistrar，含 MockUSDC 授权等多笔）；通过 VerifiableFactory 部署 resolver 实例；把名字的 resolver 指向该实例。每一项都是独立交易。
- **业务交易（演示主线，三笔）**：组织者 `authorizeTextRoles(..., true)` → 志愿者 `setText(node, "url", value)` → 组织者 `authorizeTextRoles(..., false)`。
- **拒绝验证（不上链）**：撤销后志愿者再次 `setText` 用 `eth_call` 模拟，展示真实 revert（ABI 中的 `EACUnauthorizedAccountRoles` 等自定义错误）。不为演示拒绝而发一笔注定失败的交易。

## 2. 验收标准

### 2.1 本地模拟（Codex，产品交互层）

- [ ] 流程覆盖：授权 → 志愿者改链接 → 撤销 → 志愿者再改被拒
- [ ] 负向：未授权地址改链接被拒；撤销后再改被拒
- [ ] 撤销后旧链接仍显示为当前值，并出现"请覆盖或清空"警告
- [ ] 每一页都有 SIMULATION 标识，没有交易哈希样式或"已上链"的假数据
- [ ] 模拟状态存储与界面之间通过与真实适配器同签名的接口交互（`authorize / setText / getText / check`），换真链时界面零改动
- [ ] 零依赖，一条 `node --test` 或等价命令跑完全部测试（Codex 报告核心 10 项已通过）
- [ ] 不在模拟层实现 Keccak 资源计算、角色位图、15 人上限

### 2.2 真实适配器（Sepolia）

- [ ] ABI 来自官方仓库固定 commit 的 `PermissionedResolverImpl.json`（见 3.4）；该文件不含地址，地址来自官方地址表并注明核对日期
- [ ] 每次写入前按官方应用指南**重新解析名字当前的 resolver**（`getEnsResolver` 或等价），由库负责 Universal Resolver 地址，不把某个实现地址写死为写入目标
- [ ] 使用 `authorizeTextRoles` / `authorizeNameRoles` 系列完成授权与撤销，不直接调通用的 `grantRoles` / `revokeRoles`（ABI 中存在，但 resolver 的按 key 语义由 `authorize*` 封装资源计算）
- [ ] 授权前与撤销后用 `hasRootRoles` / `hasRoles` 确认志愿者没有 root 或名字级别的 `ROLE_SET_TEXT`
- [ ] 志愿者账户（非名字所有者）在授权后成功 `setText(node, "url", value)`，交易哈希可在 Sepolia 浏览器查看
- [ ] 撤销后志愿者的 `setText` 在 `eth_call` 阶段 revert，界面展示真实错误名
- [ ] 志愿者对其他 key 的写入 revert（跨 key 验证归此层）
- [ ] 通过 Universal Resolver（viem `getEnsText` 或等价）读到最新 `url`
- [ ] 不向用户索要私钥；签名走浏览器钱包或用户自管测试账户
- [ ] 提交前录制视频并保证仓库公开

## 3. ENSv2 真实接入约束与官方出处

### 3.1 赛道要求

来源：https://ethglobal.com/events/ethonline2026/prizes/ens

- Best Use of ENSv2，总奖池 4,500 美元（1,500 / 1,500 / 1,000 / 500）
- 原文："Project must be built on ENSv2 (Sepolia)"
- 原文："ENSv2 features should be central to the product, not a cosmetic add-on"
- 原文："Your demo must be functional and not just include hard-coded values"
- 原文要求提交"video recording or link to a live demo (ideally both)"且代码开源
- 第二个奖项仅限 Continuity Track，本项目为 From Scratch，不适用
- 页面没有写明评分细则

### 3.2 Permissioned Resolver

来源：https://docs.ens.domains/ensv2/permissioned-resolver/

- 每个账户一个 resolver 实例，UUPS 代理，同一账户的名字共用
- 授权函数第一个参数是 DNS 编码的 `bytes` 名字，不是 `bytes32 node`：
  - `authorizeNameRoles(bytes toName, uint256 roleBitmap, address account, bool grant)`
  - `authorizeTextRoles(bytes toName, string key, address account, bool grant)`
  - `authorizeDataRoles(toName, key, account, grant)`
  - `authorizeAddrRoles(toName, coinType, account, grant)`
- 写函数：`setText(bytes32 node, string key, string value)`；读函数 `text(bytes32 node, string key)`
- 角色常量：`ROLE_SET_ADDR = 1 << 0`，`ROLE_SET_TEXT = 1 << 4`，`ROLE_CLEAR = 1 << 32`，`ROLE_UPGRADE = 1 << 124`，admin 角色为 `role << 128`
- 特定 text key 的资源：`resource = keccak256(namehash(name), keccak256(bytes(key)))`（由 `authorize*` 内部计算，应用层不需要自算）
- 注意事项：接口未定型；撤销角色及其 admin 角色不可逆；alias 仅经 Universal Resolver 生效

### 3.3 Enhanced Access Control

来源：https://docs.ens.domains/ensv2/enhanced-access-control/

- `grantRoles / revokeRoles` 针对具体资源，`grantRootRoles / revokeRootRoles` 针对 `ROOT_RESOURCE (0x0)`；前者拒绝 ROOT_RESOURCE 以防误发全局权限
- 位图为 `uint256`，64 个 4 bit 槽：0–127 位普通角色，128–255 位 admin 角色
- 同一资源同一角色最多 15 个持有者
- 对本项目的含义：root 或名字级别的 `ROLE_SET_TEXT` 会覆盖单 key 的撤销，见 1.4

### 3.4 官方 ABI、工厂与部署地址

- 固定 commit 的 ABI 产物：https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/PermissionedResolverImpl.json
  - 已核对：含 `abi` 与字节码，**不含 `address` 字段**
  - 含 `authorizeTextRoles(bytes,string,address,bool)`、`authorizeNameRoles(bytes,uint256,address,bool)`、`setText(bytes32,string,string)`、`text(bytes32,string)`、`initialize(address admin, uint256 roleBitmap, bytes[] setters)`
  - 含视图 `hasRoles`、`hasRootRoles`、`hasAssignees`
  - 含通用 `grantRoles / revokeRoles / grantRootRoles / revokeRootRoles`
  - 含自定义错误 `EACUnauthorizedAccountRoles`、`EACCannotGrantRoles`、`EACCannotRevokeRoles`
- 工厂（来源 https://docs.ens.domains/ensv2/verifiable-factory/）：`deployProxy(address implementation, uint256 salt, bytes data)`，`data` 为 `initialize` 编码；实际 salt 为 `keccak256(abi.encode(msg.sender, salt))`
- Sepolia ENSv2 Beta 地址（来源 https://docs.ens.domains/learn/deployments/ ，2026-09-05 核对，可能重新部署；写入目标以每次解析到的 resolver 为准）：

| 合约 | 地址 |
|---|---|
| VerifiableFactory | 0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef |
| PermissionedResolverImpl | 0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e |
| UniversalResolverV2 | 0x4a1817d13e9cf196f471725176355c1234b63c70 |
| ETHRegistrar | 0xa88553f454b77203b0d036a05c894d555eaaa2cc |
| ETHRegistry | 0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2 |
| MockUSDC | 0x768f42455a2d082e23ceef7d51e5787c82d67a39 |

- 官方说明 Sepolia 上的 ENS 应用通过这套部署解析，志愿者改完的 `url` 可在 Sepolia ENS 管理界面看到，是很好的演示佐证

### 3.5 应用开发教程

来源：https://docs.ens.domains/ensv2/tutorial-app-developers/

- 写入流程：先 `getEnsResolver()` 取名字当前 resolver，计算 namehash，调 setter，可用 `multicall(bytes[] data)` 批量。每次写前重新解析，不固定实现地址
- 读取走 Universal Resolver，库负责其地址，应用直接用 `getEnsText()`
- 推荐库：viem 与 ENSjs；ENSjs 提供 `setTextRecord()` 等写入辅助

### 3.6 未在文档中确认、必须上链验证的点

- `authorizeTextRoles` 的调用者权限检查
- `PublicResolverV2` 是否也支持按 key 授权（文档未说明，不能假设）
- 在 Sepolia 上获得可用 `.eth` 名字的最小路径（是否需先领 MockUSDC）
- 志愿者 `setText` 是否还需要名字级别的其他角色

## 4. 下一轮建议

1. **先做 3.6 的链上验证再接前端**。用只读 RPC 与 `eth_call` 逐项验证，每项一个脚本，输出真实 revert 数据。不花钱、不需要私钥、不发交易。
2. **接口先行**。模拟实现与真实适配器同签名，界面只依赖接口。
3. **ABI 只用 3.4 的固定 commit 产物**，地址来自官方地址表并注明日期。
4. **演示脚本按"前置设置 + 三笔业务交易 + 一次 eth_call 拒绝"组织**。拒绝那一步最能证明 ENSv2 是核心。
5. **撤销流程加角色检查**：撤销后立即 `hasRoles` / `hasRootRoles` 确认志愿者无残留角色，再提示覆盖旧链接。
6. **提交材料**：README 写清 Sepolia 地址、交易哈希、视频链接；SIMULATION 模式仅作无钱包时的备用演示，明确标注不是链上结果、不构成赛道完成。
