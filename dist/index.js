/**
 * dsh-plugin-balance
 * DeepSeek Harness 插件 - 展示当前账户余额（轮询式）
 *
 * 这是一个标准的 DSH bundle 插件：
 * - package.json 通过 `dsh.bundle.patch` 指向 cordis.patch.yml，安装后由
 *   `dsh plugin` 的 reconcile 逻辑自动加入 profile 的 `dsh.profile.bundles`
 *   层列表，成为 profile 组合的一层；
 * - loader 按入口行的 `name: dsh-plugin-balance` 动态 import 本包，并取
 *   命名导出 `{ apply, inject, name }`（不要导出 default：unwrapExports
 *   会优先取 default 而丢掉 inject）；
 * - 工具通过 `ctx.tools.register(defineTool(...))` 注册
 *   （@deepseek-ai/dsh-tools），命令通过 `ctx.commands.register(...)` 注册
 *   （dsh-commands 服务），配置作为 `apply(ctx, config)` 的第二参数传入；
 * - 定时器清理通过 `ctx.effect()` 返回的 disposer 完成。
 *
 * API: GET https://api.deepseek.com/user/balance
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
// ==================== 常量 ====================
const API_URL = 'https://api.deepseek.com/user/balance';
const DEFAULT_INTERVAL = 1800000; // 30 分钟
const MIN_INTERVAL = 60000; // 1 分钟
const MAX_INTERVAL = 3600000; // 1 小时
// ==================== 服务层：HTTP 客户端 ====================
/**
 * BalanceService - HTTP 客户端
 *
 * 封装对 DeepSeek /user/balance API 的调用：Bearer Token 认证、单次请求、
 * 10 秒超时、无状态。
 */
export class BalanceService {
    static async fetchBalance(apiKey) {
        const response = await fetch(API_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    /** 验证并规范化轮询间隔 */
    static normalizeInterval(interval) {
        if (!interval || Number.isNaN(interval)) {
            return DEFAULT_INTERVAL;
        }
        return Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, interval));
    }
}
// ==================== 视图模型层：状态管理 + 轮询 ====================
/**
 * BalanceViewModel - 状态管理与轮询调度
 *
 * - 管理余额状态（当前值 + 加载状态 + 错误状态）
 * - 定时轮询调度（启动/停止/重启）
 * - 容错：网络错误保留上次成功的数据（过期数据 > 没有数据）
 * - API Key 每次刷新按需读取，不持久化到内存
 */
export class BalanceViewModel {
    _balance = null;
    _loading = false;
    _lastError = null;
    _lastUpdateTime = null;
    timer = null;
    interval;
    ctx;
    apiKeyProvider;
    constructor(ctx, options) {
        this.ctx = ctx;
        this.interval = BalanceService.normalizeInterval(options.interval);
        this.apiKeyProvider = options.apiKeyProvider;
    }
    get balance() { return this._balance; }
    get loading() { return this._loading; }
    get lastError() { return this._lastError; }
    get lastUpdateTime() { return this._lastUpdateTime; }
    get isAvailable() { return this._balance !== null && !this._loading; }
    get refreshInterval() { return this.interval; }
    /** 执行一次余额查询并更新状态；失败时保留上次成功数据 */
    async refresh() {
        if (this._loading) {
            this.ctx.logger.debug('[dsh-plugin-balance] 上次查询仍在进行中，跳过本次');
            return;
        }
        const apiKey = this.apiKeyProvider();
        if (!apiKey) {
            this._lastError = new Error('API Key 未配置（设置 DEEPSEEK_API_KEY 环境变量或插件配置 apiKey）');
            this.ctx.logger.warn(`[dsh-plugin-balance] ${this._lastError.message}`);
            return;
        }
        this._loading = true;
        this._lastError = null;
        try {
            const data = await BalanceService.fetchBalance(apiKey);
            this._balance = data;
            this._lastUpdateTime = new Date();
            this.ctx.logger.info('[dsh-plugin-balance] 余额更新成功');
        }
        catch (error) {
            this._lastError = error instanceof Error ? error : new Error(String(error));
            // 失败：记录错误，但不清空旧数据（过期数据 > 没有数据）
            this.ctx.logger.error(`[dsh-plugin-balance] 查询失败: ${this._lastError.message}（保留上次数据）`);
        }
        finally {
            this._loading = false;
        }
    }
    /** 启动自动轮询：立即执行第一次查询，之后按 interval 定时刷新 */
    startPolling() {
        this.stopPolling();
        this.ctx.logger.info(`[dsh-plugin-balance] 启动轮询，间隔: ${this.interval / 1000}秒`);
        void this.refresh();
        this.timer = setInterval(() => {
            this.refresh().catch((err) => {
                this.ctx.logger.error(`[dsh-plugin-balance] 轮询异常: ${err instanceof Error ? err.message : String(err)}`);
            });
        }, this.interval);
    }
    stopPolling() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
            this.ctx.logger.info('[dsh-plugin-balance] 已停止轮询');
        }
    }
    /** 重启轮询（用于配置变更，如修改了刷新间隔或 API Key） */
    restartPolling(newInterval) {
        if (newInterval !== undefined) {
            this.interval = BalanceService.normalizeInterval(newInterval);
        }
        this.startPolling();
    }
    /** 清理资源（插件卸载时调用） */
    dispose() {
        this.stopPolling();
        this._balance = null;
        this._lastError = null;
        this._lastUpdateTime = null;
    }
}
// ==================== 格式化 ====================
/** 将余额数据格式化为人类可读文本 */
export function formatBalanceText(data) {
    const { balance_info, currency } = data;
    return [
        '💰 账户余额',
        '━━━━━━━━━━━━━━━━━━━━',
        `📊 总余额:     ${balance_info.total_balance.toFixed(4)} ${currency}`,
        `🎁 赠送余额:   ${balance_info.granted_balance.toFixed(4)} ${currency}`,
        `💳 充值余额:   ${balance_info.topup_balance.toFixed(4)} ${currency}`,
        '━━━━━━━━━━━━━━━━━━━━',
        `⏰ 更新时间:   ${new Date().toLocaleString('zh-CN')}`,
    ].join('\n');
}
/** 基于 ViewModel 当前状态生成摘要文本 */
function snapshotText(viewModel) {
    const { balance, lastError, lastUpdateTime, refreshInterval } = viewModel;
    if (!balance) {
        return `❌ 暂无余额数据${lastError ? `：${lastError.message}` : ''}（请检查网络连接和 API Key 配置）`;
    }
    const { balance_info, currency } = balance;
    return [
        '💰 账户余额查询结果',
        '━━━━━━━━━━━━━━━━━━━━',
        `📊 总余额:     ${balance_info.total_balance.toFixed(4)} ${currency}`,
        `🎁 赠送余额:   ${balance_info.granted_balance.toFixed(4)} ${currency}`,
        `💳 充值余额:   ${balance_info.topup_balance.toFixed(4)} ${currency}`,
        '━━━━━━━━━━━━━━━━━━━━',
        `⏰ 查询时间:   ${lastUpdateTime?.toLocaleString('zh-CN') ?? '未知'}`,
        `🔄 下次刷新:   ${refreshInterval / 1000}秒后`,
    ].join('\n');
}
/** 查询类工具的统一返回结构 */
function toSnapshotResult(viewModel) {
    const { balance, lastError, lastUpdateTime } = viewModel;
    return {
        success: viewModel.isAvailable,
        text: snapshotText(viewModel),
        totalBalance: balance?.balance_info.total_balance ?? null,
        grantedBalance: balance?.balance_info.granted_balance ?? null,
        topupBalance: balance?.balance_info.topup_balance ?? null,
        currency: balance?.currency ?? null,
        lastUpdate: lastUpdateTime?.toISOString() ?? null,
    };
}
// ==================== 插件入口 ====================
/**
 * 插件主入口
 *
 * 初始化流程：
 * 1. 读取配置（第二参数，来自入口行 config，apiKey 回退到环境变量）
 * 2. 创建 ViewModel 实例
 * 3. 注册命令 /balance 与四个工具
 * 4. 配置了 API Key 时启动轮询（ctx.effect 管理生命周期）
 */
function apply(ctx, config = {}) {
    const apiKeyProvider = () => config.apiKey || process.env.DEEPSEEK_API_KEY || '';
    const viewModel = new BalanceViewModel(ctx, {
        interval: config.refreshInterval,
        apiKeyProvider,
    });
    // ---- 命令：/balance ----
    ctx.commands.register({
        name: 'balance',
        description: '查询 DeepSeek API 账户余额（总余额、赠送余额、充值余额）',
        input: { hint: '' },
        handler: async () => {
            await viewModel.refresh();
            return {
                kind: viewModel.isAvailable ? 'success' : 'error',
                text: snapshotText(viewModel),
            };
        },
    });
    // ---- 工具：立即查询余额 ----
    ctx.tools.register(defineTool({
        name: 'query-balance',
        description: '查询 DeepSeek API 账户余额（立即发起一次请求，返回总余额、赠送余额、充值余额）',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    success: { type: 'boolean', required: true },
                    text: { type: 'string', required: true },
                    totalBalance: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                    grantedBalance: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                    topupBalance: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                    currency: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    lastUpdate: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                },
            },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute() {
            await viewModel.refresh();
            return toSnapshotResult(viewModel);
        },
    }));
    // ---- 工具：读取缓存（不发起请求） ----
    ctx.tools.register(defineTool({
        name: 'get-cached-balance',
        description: '获取当前缓存的 DeepSeek 账户余额（不发起网络请求）',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    available: { type: 'boolean', required: true },
                    text: { type: 'string', required: true },
                    loading: { type: 'boolean', required: true },
                    lastUpdate: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    nextRefreshInSeconds: { type: 'number', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute() {
            const { balance, lastError, lastUpdateTime, refreshInterval } = viewModel;
            return {
                available: viewModel.isAvailable,
                text: balance
                    ? snapshotText(viewModel)
                    : `❌ 暂无余额数据${lastError ? `：${lastError.message}` : ''}`,
                loading: viewModel.loading,
                lastUpdate: lastUpdateTime?.toISOString() ?? null,
                nextRefreshInSeconds: refreshInterval / 1000,
            };
        },
    }));
    // ---- 工具：立即刷新 ----
    ctx.tools.register(defineTool({
        name: 'refresh-balance',
        description: '立即刷新 DeepSeek 账户余额数据',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    success: { type: 'boolean', required: true },
                    text: { type: 'string', required: true },
                    totalBalance: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                    grantedBalance: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                    topupBalance: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                    currency: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    lastUpdate: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                },
            },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute() {
            await viewModel.refresh();
            return toSnapshotResult(viewModel);
        },
    }));
    // ---- 工具：动态修改轮询间隔 ----
    ctx.tools.register(defineTool({
        name: 'set-refresh-interval',
        description: '动态修改余额轮询间隔（毫秒，范围 60000-3600000）',
        parameters: {
            interval: {
                type: 'number',
                required: true,
                description: '新的轮询间隔（毫秒），范围 60000-3600000',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    success: { type: 'boolean', required: true },
                    interval: { type: 'number', required: true },
                    text: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute(args) {
            viewModel.restartPolling(args.interval);
            return {
                success: true,
                interval: viewModel.refreshInterval,
                text: `已将轮询间隔设置为 ${viewModel.refreshInterval / 1000}秒`,
            };
        },
    }));
    // ---- 轮询（仅在配置了 API Key 时启动；ctx.effect 卸载时自动 dispose） ----
    ctx.effect(() => {
        if (!apiKeyProvider()) {
            ctx.logger.warn('[dsh-plugin-balance] 未配置 API Key：仅注册工具与命令，不启动轮询（设置 DEEPSEEK_API_KEY 环境变量或插件配置 apiKey 后可用）');
            return () => { };
        }
        viewModel.startPolling();
        return () => viewModel.dispose();
    });
    ctx.logger.info('[dsh-plugin-balance] 插件已加载 ✅');
}
const inject = ['tools', 'commands'];
const name = 'plugin-balance';
// 命名导出（DSH loader 约定：不导出 default，否则 unwrapExports 取 default 而丢掉 inject）
export { apply, inject, name };
