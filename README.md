# dsh-plugin-balance

**DeepSeek Harness 插件 - 展示当前账户余额**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 功能特性

- 📊 **实时查询** - 调用 DeepSeek 官方 API 查询账户余额
- 💰 **详细信息** - 显示总余额、赠送余额、充值余额
- ⏰ **自动刷新** - 支持可配置的自动刷新间隔
- 🔧 **Agent 工具** - 可被 DSH Agent 直接调用
- 📝 **命令支持** - 支持 `/balance` 或 `/余额` 命令
- 🔄 **离线缓存** - 网络异常时返回最近一次缓存数据

## 📋 余额信息展示

```
💰 账户余额查询结果
━━━━━━━━━━━━━━━━━━━━
📊 总余额:     15.5187 CNY
🎁 赠送余额:   14.9287 CNY
💳 充值余额:   0.5900 CNY
━━━━━━━━━━━━━━━━━━━━
⏰ 查询时间:   2026/8/15 10:30:00
```

## 🚀 安装

### 方式一：通过 DSH 安装（推荐）

```bash
dsh plugin --profile web add github:wgananh/dsh-plugin-balance
```

### 方式二：手动安装

```bash
# 克隆仓库
git clone https://github.com/wgananh/dsh-plugin-balance.git
cd dsh-plugin-balance

# 安装依赖并构建
npm install
npm run build
```

## ⚙️ 配置

### 环境变量（推荐）

```bash
export DEEPSEEK_API_KEY="your-api-key-here"
```

### 配置文件

在 DSH 配置文件中添加：

```json
{
  "plugins": {
    "dsh-plugin-balance": {
      "apiKey": "your-api-key-here",
      "refreshInterval": 60000
    }
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `apiKey` | `string` | 必填 | DeepSeek API Key |
| `refreshInterval` | `number` | `60000` | 自动刷新间隔（毫秒） |

## 📖 使用方法

### 1. 命令行方式

在 DSH 中输入：

```
/balance
```

或中文别名：

```
/余额
```

### 2. Agent 工具调用

DSH Agent 可以通过内置工具 `query-balance` 自动获取余额信息：

> 用户："我还有多少余额？"
>
> Agent 自动调用 `query-balance` 工具 → 返回余额数据

### 3. 编程方式

```typescript
import { BalanceService } from 'dsh-plugin-balance';

const service = new BalanceService(ctx, { apiKey: 'your-key' });
const balance = await service.queryBalance();
console.log(balance.balance_info.total_balance);
```

## 🔌 API 参考

### 使用的 DeepSeek API

- **端点**: `GET https://api.deepseek.com/user/balance`
- **认证**: `Authorization: Bearer <API_KEY>`
- **文档**: [DeepSeek API 文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)

### 返回数据结构

```typescript
interface BalanceInfo {
  total_balance: number;   // 总余额
  granted_balance: number; // 赠送余额
  topup_balance: number;   // 充值余额
}

interface BalanceResponse {
  balance_info: BalanceInfo;
  currency: string;        // 币种（如 CNY）
}
```

## 🏗️ 项目结构

```
dsh-plugin-balance/
├── src/
│   └── index.ts          # 插件主代码
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
├── README.md              # 项目文档
└── .gitignore            # Git 忽略规则
```

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 构建
npm run build
```

## 📄 License

MIT License

## 🙏 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) - Agent 运行框架
- [Cordis](https://github.com/cordisjs/cordis) - 插件元框架
- [DeepSeek API](https://platform.deepseek.com/) - API 服务
