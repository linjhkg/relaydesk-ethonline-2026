# RelayDesk · 活动链接交接台

社区活动更换志愿者，不必交出整个钱包或每次重新群发入口。设想以 ENS 子名作为稳定入口，只委派报名链接记录的编辑权，交接结束即可撤销。

**当前版本：本地模拟，不是 ENSv2 链上成品。** 角色切换仅用于演示，不是登录；名字是虚构的，状态只存在本地服务内存中。没有真实钱包调用、代币转账或已验证商业收入。不要部署为公网权限服务。

## 运行

需要 Node.js 24+，零第三方依赖。

```sh
npm test
npm run check
npm start
```

浏览器打开 http://127.0.0.1:4317 。服务仅绑定本机，重启或重置会清空演示数据。

`npm run preflight` 可只读检查 Sepolia 网络及官方部署地址代码是否存在，不需要钱包或密钥，不会发送交易；这不代表权限集成已经完成。

## 60 秒验收

1. 组织者角色授权志愿者修改 `url`。
2. 切到志愿者，把链接改为合法的 `https://` 地址；观察公众入口名称不变、链接变更、日志新增。
3. 切回组织者撤销权限。
4. 切到志愿者再次提交：应明确拒绝，原值和版本号不变。
5. 切换未授权者也应拒绝；`javascript:`、`http:` 或包含用户名密码的 URL 应拒绝。

## 真实 ENSv2 下一里程碑

在 Sepolia 以 Permissioned Resolver 的记录键权限实现同一过程，而非另造一个泛化的“管理员角色”合约。必须核实官方 ABI、库版本、实际部署地址及名称授权。SDK 依赖选择与钱包签名还未实施。

来源：[ENS 赛道](https://ethglobal.com/events/ethonline2026/prizes/ens)、[ENSv2 应用教程](https://docs.ens.domains/ensv2/tutorial-app-developers/)、[Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver)。资格要求以主办方实时规则为准；仅本地模拟不满足真实 ENSv2 集成要求。
