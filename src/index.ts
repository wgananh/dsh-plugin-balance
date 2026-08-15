/**
 * dsh-plugin-balance
 * DeepSeek Harness 插件 - 展示当前账户余额（轮询式）
 *
 * 参考 DeepSeek Status Bar (CC Switch) 的轮询架构：
 * - MVVM 设计：BalanceViewModel（状态管理+定时器）→ BalanceService（HTTP客户端）→ DeepSeek API
 * - 可配置 60–3600 秒轮询间隔，默认 30 分钟
 * - 网络错误不清空已有余额数据（过期数据 > 没有数据）
 * - 每次刷新按需读取 API Key，不持久化到内存
 *
 * API: GET https://api.deepseek.com/user/balance
 */

import { Context, Schema, Service } from '@deepseek-ai/cordis';

// ==================== 数据模型 ====================

/** 余额信息 */
export interface BalanceInfo {
  total_balance: number;   // 总余额
  granted_balance: number; // 赠送余额
  topup_balance: number;   // 充值余额
}

/** API 响应 */
export interface BalanceResponse {
  balance_info: BalanceInfo;
  currency: string;
}

// ==================== 配置 Schema ====================

export interface BalanceConfig {
  /** DeepSeek API Key */
  apiKey: string;
  /** 轮询间隔（毫秒），范围 60000-3600000，默认 1800000（30分钟） */
  refreshInterval?: number;
}

export const BalanceConfigSchema = Schema.object({
  apiKey: Schema.string()
    .description('DeepSeek API Key')
    .required(),
  refreshInterval: Schema.number()
    .default(1800000)
    .description('轮询间隔（毫秒），范围 60000-3600000，默认 30分钟'),
});

// ==================== 服务层：HTTP 客户端 ====================

/**
 * BalanceService - HTTP 客户端
 *
 * 职责：
 * - 封装对 DeepSeek /user/balance API 的调用
 * - Bearer Token 认证
 * - 单次请求，无状态
 *
 * 设计参考：DeepSeek Status Bar 的 BillingService
 */
export class BalanceService {
  private static readonly API_URL = 'https://api.deepseek.com/user/balance';
  private static readonly MIN_INTERVAL = 60000;   // 1分钟
  private static readonly MAX_INTERVAL = 3600000; // 1小时
  private static readonly DEFAULT_INTERVAL = 1800000; // 30分钟

  /**
   * 查询账户余额（单次请求）
   *
   * @param apiKey - API Key（每次调用传入，不缓存）
   * @returns 余额响应数据
   * @throws 网络错误或 API 错误
   */
  static async fetchBalance(apiKey: string): Promise<BalanceResponse> {
    const response = await fetch(BalanceService.API_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // 设置超时时间 10 秒
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(
        `API 请求失败: ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<BalanceResponse>;
  }

  /**
   * 验证并规范化轮询间隔
   */
  static normalizeInterval(interval?: number): number {
    if (!interval || isNaN(interval)) {
      return BalanceService.DEFAULT_INTERVAL;
    }
    return Math.max(
      BalanceService.MIN_INTERVAL,
      Math.min(BalanceService.MAX_INTERVAL, interval)
    );
  }
}

// ==================== 视图模型层：状态管理 + 定时器 ====================

/**
 * BalanceViewModel - 状态管理与轮询调度
 *
 * 职责：
 * - 管理余额状态（当前值 + 加载状态 + 错误状态）
 * - 定时轮询调度（启动/停止/重启）
 * - 状态变更通知（通过事件发射）
 * - 容错：网络错误保留上次成功的数据
 *
 * 设计参考：DeepSeek Status Bar 的 BillingViewModel（@MainActor ObservableObject）
 */
export class BalanceViewModel {
  /** 当前余额数据（可能为 null 或过期） */
  private _balance: BalanceResponse | null = null;

  /** 是否正在加载 */
  private _loading = false;

  /** 最后一次错误 */
  private _lastError: Error | null = null;

  /** 最后一次成功更新时间 */
  private _lastUpdateTime: Date | null = null;

  /** 轮询定时器 */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** 当前配置的轮询间隔（毫秒） */
  private interval: number;

  /** DSH Context（用于日志和事件） */
  private ctx: Context;

  /** 获取 API Key 的函数（每次调用，不缓存） */
  private apiKeyProvider: () => string;

  constructor(ctx: Context, options: {
    interval: number;
    apiKeyProvider: () => string;
  }) {
    this.ctx = ctx;
    this.interval = BalanceService.normalizeInterval(options.interval);
    this.apiKeyProvider = options.apiKeyProvider;
  }

  // ==================== 公共属性访问器 ====================

  get balance(): BalanceResponse | null { return this._balance; }
  get loading(): boolean { return this._loading; }
  get lastError(): Error | null { return this._lastError; }
  get lastUpdateTime(): Date | null { return this._lastUpdateTime; }

  /** 余额是否可用（有数据且未处于加载状态） */
  get isAvailable(): boolean { return this._balance !== null && !this._loading; }

  // ==================== 核心方法 ====================

  /**
   * 执行一次余额查询并更新状态
   *
   * 流程：
   * 1. 通过 apiKeyProvider 获取最新的 API Key（不缓存）
   * 2. 调用 BalanceService.fetchBalance 发起请求
   * 3. 成功：更新 _balance 和 _lastUpdateTime，清除 _lastError
   * 4. 失败：设置 _lastError，**保留旧的 _balance 数据**（容错设计）
   * 5. 触发状态变更事件
   */
  async refresh(): Promise<void> {
    // 防止并发请求
    if (this._loading) {
      this.ctx.logger.debug('[dsh-plugin-balance] 上次查询仍在进行中，跳过本次');
      return;
    }

    const apiKey = this.apiKeyProvider();
    if (!apiKey) {
      this._lastError = new Error('API Key 未配置');
      this.ctx.logger.warn('[dsh-plugin-balance] API Key 未配置，无法查询余额');
      return;
    }

    this._loading = true;
    this._lastError = null;

    try {
      const data = await BalanceService.fetchBalance(apiKey);

      // 成功：更新状态
      this._balance = data;
      this._lastUpdateTime = new Date();

      this.logBalance(data);
      this.emitChange();

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 失败：记录错误，但**不清空旧数据**（参考 DeepSeek Status Bar 的容错设计）
      this._lastError = err;
      this.ctx.logger.error(`[dsh-plugin-balance] 查询失败: ${err.message}`);
      this.ctx.logger.info(
        '[dsh-plugin-balance] 保留上次的余额数据（过期数据 > 没有数据）'
      );

      this.emitChange();

    } finally {
      this._loading = false;
    }
  }

  /**
   * 启动自动轮询
   *
   * 行为：
   * - 立即执行第一次查询
   * - 然后每隔 interval 毫秒自动执行一次
   * - 如果已在运行，先停止再重启（用于配置变更后）
   */
  startPolling(): void {
    this.stopPolling();

    this.ctx.logger.info(
      `[dsh-plugin-balance] 启动轮询，间隔: ${this.interval / 1000}秒`
    );

    // 立即执行第一次
    this.refresh();

    // 设置定时器
    this.timer = setInterval(() => {
      this.refresh().catch((err) => {
        this.ctx.logger.error(`[dsh-plugin-balance] 轮询异常: ${err.message}`);
      });
    }, this.interval);
  }

  /**
   * 停止自动轮询
   */
  stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.ctx.logger.info('[dsh-plugin-balance] 已停止轮询');
    }
  }

  /**
   * 重启轮询（用于配置变更，如修改了刷新间隔或 API Key）
   */
  restartPolling(newInterval?: number): void {
    if (newInterval !== undefined) {
      this.interval = BalanceService.normalizeInterval(newInterval);
    }
    this.startPolling();
  }

  // ==================== 私有方法 ====================

  /**
   * 格式化输出余额日志
   */
  private logBalance(data: BalanceResponse): void {
    const { balance_info, currency } = data;
    const lines = [
      '',
      '💰 账户余额查询结果',
      '━━━━━━━━━━━━━━━━━━━━',
      `📊 总余额:     ${balance_info.total_balance.toFixed(4)} ${currency}`,
      `🎁 赠送余额:   ${balance_info.granted_balance.toFixed(4)} ${currency}`,
      `💳 充值余额:   ${balance_info.topup_balance.toFixed(4)} ${currency}`,
      '━━━━━━━━━━━━━━━━━━━━',
      `⏰ 查询时间:   ${this._lastUpdateTime?.toLocaleString('zh-CN') ?? '未知'}`,
      `🔄 下次刷新:   ${(this.interval / 1000).toFixed(0)}秒后`,
      '',
    ];

    this.ctx.logger.info(lines.join('\n'));
  }

  /**
   * 触发状态变更事件（供 UI 层或其他组件监听）
   */
  private emitChange(): void {
    this.ctx.emit('plugin-balance:change', {
      balance: this._balance,
      loading: this._loading,
      error: this._lastError?.message,
      lastUpdate: this._lastUpdateTime,
    });
  }

  /**
   * 清理资源（插件卸载时调用）
   */
  dispose(): void {
    this.stopPolling();
    this._balance = null;
    this._lastError = null;
    this._lastUpdateTime = null;
  }
}

// ==================== 插件入口 ====================

/**
 * 插件主入口
 *
 * 初始化流程：
 * 1. 从配置/环境变量读取 API Key
 * 2. 创建 ViewModel 实例
 * 3. 注册命令和工具
 * 4. 启动轮询
 */
export function apply(ctx: Context): void {
  // ---- 配置读取 ----
  const rawConfig = ctx.config || {};
  const config: BalanceConfig = {
    apiKey: rawConfig.apiKey || process.env.DEEPSEEK_API_KEY || '',
    refreshInterval: rawConfig.refreshInterval,
  };

  if (!config.apiKey) {
    ctx.logger.warn(
      '[dsh-plugin-balance] ⚠️ 未配置 API Key\n' +
      '请设置 DEEPSEEK_API_KEY 环境变量或在配置中提供 apiKey\n' +
      '示例：\n' +
      '  export DEEPSEEK_API_KEY="sk-xxx"\n' +
      '  # 或在 DSH 配置中添加：\n' +
      '  { "plugins": { "dsh-plugin-balance": { "apiKey": "sk-xxx" } } }'
    );
    return;
  }

  // ---- 创建 ViewModel ----
  const viewModel = new BalanceViewModel(ctx, {
    interval: config.refreshInterval,
    apiKeyProvider: () =>
      ctx.config?.apiKey || process.env.DEEPSEEK_API_KEY || '',
  });

  // ---- 注册命令：手动查询余额 ----
  ctx.command('balance')
    .alias('余额')
    .action(async () => {
      await viewModel.refresh();
      return viewModel.balance
        ? formatBalanceText(viewModel.balance!)
        : '❌ 暂无余额数据（请检查网络连接和 API Key 配置）';
    });

  // ---- 注册工具：供 Agent 自动调用 ----
  ctx.tool('query-balance', {
    params: {},
    description: '查询 DeepSeek API 账户余额（返回总余额、赠送余额、充值余额）',
  }, async () => {
    await viewModel.refresh();

    return {
      success: viewModel.isAvailable,
      data: viewModel.balance,
      error: viewModel.lastError?.message,
      lastUpdate: viewModel.lastUpdateTime?.toISOString(),
    };
  });

  // ---- 注册工具：获取当前缓存的余额（不发起新请求） ----
  ctx.tool('get-cached-balance', {
    params: {},
    description: '获取当前缓存的余额数据（不发起网络请求）',
  }, async () => {
    return {
      available: viewModel.isAvailable,
      data: viewModel.balance,
      loading: viewModel.loading,
      lastUpdate: viewModel.lastUpdateTime?.toISOString(),
      nextRefreshIn: `${viewModel['interval'] / 1000}s`,
    };
  });

  // ---- 注册工具：手动触发刷新 ----
  ctx.tool('refresh-balance', {
    params: {},
    description: '立即刷新余额数据',
  }, async () => {
    await viewModel.refresh();
    return {
      success: viewModel.isAvailable,
      data: viewModel.balance,
      updated: viewModel.lastUpdateTime?.toISOString(),
    };
  });

  // ---- 注册工具：修改轮询间隔 ----
  ctx.tool('set-refresh-interval', {
    params: {
      interval: Schema.number()
        .description('新的轮询间隔（毫秒），范围 60000-3600000'),
    },
    description: '动态修改余额轮询间隔',
  }, async ({ interval }) => {
    viewModel.restartPolling(interval);
    return {
      success: true,
      newInterval: viewModel['interval'],
      message: `已将轮询间隔设置为 ${(viewModel['interval'] / 1000)}秒`,
    };
  });

  // ---- 启动轮询 ----
  viewModel.startPolling();

  // ---- 插件卸载时清理 ----
  ctx.on('dispose', () => {
    viewModel.dispose();
    ctx.logger.info('[dsh-plugin-balance] 插件已卸载 ✅');
  });

  ctx.logger.info('[dsh-plugin-balance] 插件已加载 ✅');
  ctx.logger.info(`[dsh-plugin-balance] 轮询间隔: ${config.refreshInterval ? BalanceService.normalizeInterval(config.refreshInterval) / 1000 : 30}秒`);
}

// ==================== 工具函数 ====================

/**
 * 将余额数据格式化为人类可读文本
 */
function formatBalanceText(data: BalanceResponse): string {
  const { balance_info, currency } = data;
  return [
    '💰 账户余额',
    `━━━━━━━━━━━━━━━━━━━━`,
    `📊 总余额:     ${balance_info.total_balance.toFixed(4)} ${currency}`,
    `🎁 赠送余额:   ${balance_info.granted_balance.toFixed(4)} ${currency}`,
    `💳 充值余额:   ${balance_info.topup_balance.toFixed(4)} ${currency}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⏰ 更新时间:   ${new Date().toLocaleString('zh-CN')}`,
  ].join('\n');
}

// 导出默认插件对象
export default apply;

// 导出类型和类（供外部使用）
export type { BalanceConfig };
