# dsh-plugin-balance

**DeepSeek Harness 插件 - 展示当前账户余额（轮询式）**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 功能特性

- 📊 **实时查询** - 调用 DeepSeek 官方 API 查询账户余额
- 💰 **详细信息** - 显示总余额、赠送余额、充值余额
- ⏰ **自动刷新** - 支持可配置的自动刷新间隔（60s ~ 60min，默认 30min）
- 🔧 **Agent 工具** - 可被 DSH Agent 直接调用（`query-balance` 等 4 个工具）
- 📝 **命令支持** - 支持 `/balance` 命令
- 🔄 **离线缓存** - 网络异常时返回最近一次缓存数据

## 🚀 安装

本包是一个 **DSH bundle 插件**：`package.json` 通过 `dsh.bundle.patch` 声明
`cordis.patch.yml`，`dsh plugin` 安装后会自动把它加入 profile 的
`dsh.profile.bundles` 层列表（无需手工编辑配置），loader 启动时动态
import `dist/index.js`（`main` 入口）加载插件。

```bash
# 方式一：通过 DSH 安装（推荐）
dsh plugin --profile web add github:wgananh/dsh-plugin-balance

# 方式二：本地路径安装（开发调试）
dsh plugin --profile web add file:C:/path/to/dsh-plugin-balance
```

> 说明：`dist/` 是已提交的构建产物，git 安装后无需额外构建即可加载。
> 修改 `src/` 后请运行 `npm run build` 并提交新的 `dist/`。

## ⚙️ 配置

### 环境变量（推荐）

```bash
export DEEPSEEK_API_KEY="your-api-key-here"
```

插件每次查询都会重新读取 `DEEPSEEK_API_KEY`，不缓存到内存。

### 固定密钥（可选）

不要在 `cordis.patch.yml`（随仓库分发）里写密钥。如需固定，在 profile 的
`~/.dsh/profiles/web/cordis.patch.yml` 中按行 id 覆盖：

```yaml
- id: plugin-balance
  config:
    apiKey: "your-api-key-here"
    refreshInterval: 60000
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `apiKey` | `string` | 环境变量 | DeepSeek API Key |
| `refreshInterval` | `number` | `1800000` | 自动刷新间隔（毫秒），范围 60000-3600000 |

## 📖 使用方法

### 1. 命令行方式

```
/balance
```

### 2. Agent 工具调用

| 工具名 | 说明 |
|--------|------|
| `query-balance` | 立即发起一次请求并返回余额 |
| `get-cached-balance` | 读取缓存的余额（不发起网络请求） |
| `refresh-balance` | 立即刷新余额数据 |
| `set-refresh-interval` | 动态修改轮询间隔（毫秒） |

> 用户："我还有多少余额？"
>
> Agent 自动调用 `query-balance` 工具 → 返回余额数据

### 3. 编程方式

```typescript
import { BalanceService } from 'dsh-plugin-balance';

const balance = await BalanceService.fetchBalance('your-api-key');
console.log(balance.balance_info.total_balance);
```

## 🔌 API 参考

- **端点**: `GET https://api.deepseek.com/user/balance`
- **认证**: `Authorization: Bearer <API_KEY>`
- **文档**: [DeepSeek API 文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)

## 🏗️ 项目结构

```
dsh-plugin-balance/
├── src/
│   └── index.ts          # 插件主代码（DSH 插件 API）
├── dist/                 # tsc 构建产物（已提交，git 安装直接可用）
├── cordis.patch.yml      # bundle patch：向 profile 插入插件行
├── package.json          # 含 dsh.bundle 声明与依赖
├── tsconfig.json         # TypeScript 配置
└── README.md             # 项目文档
```

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式（监听文件变化）
npm run dev
```

DSH 插件契约要点（本仓库已按此实现）：

1. `package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
   —— 否则 `dsh plugin` 只会把它当普通依赖装进 profile，不会激活；
2. `cordis.patch.yml` 用 `insert` 列表插入入口行（`id` + `name` + `config`）；
3. 模块只导出**命名成员** `{ apply, inject, name }`（不要 `export default`，
   loader 的 `unwrapExports` 会优先取 default 而丢掉 inject）；
4. 工具用 `ctx.tools.register(defineTool(...))`（`@deepseek-ai/dsh-tools`），
   命令用 `ctx.commands.register(...)`（dsh-commands 服务）；
5. 配置是 `apply(ctx, config)` 的第二参数；定时器等清理走
   `ctx.effect()` 返回的 disposer。

## 📄 License

MIT License

## 🙏 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) - Agent 运行框架
- [Cordis](https://github.com/cordisjs/cordis) - 插件元框架
- [DeepSeek API](https://platform.deepseek.com/) - API 服务
