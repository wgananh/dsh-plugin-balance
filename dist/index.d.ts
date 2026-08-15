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
import type { Context } from '@deepseek-ai/cordis';
/** 余额信息 */
export interface BalanceInfo {
    total_balance: number;
    granted_balance: number;
    topup_balance: number;
}
/** API 响应 */
export interface BalanceResponse {
    balance_info: BalanceInfo;
    currency: string;
}
/** 插件配置（对应 cordis.patch.yml 中该行的 config） */
export interface BalanceConfig {
    /** DeepSeek API Key；缺省时回退到环境变量 DEEPSEEK_API_KEY */
    apiKey?: string;
    /** 轮询间隔（毫秒），范围 60000-3600000，默认 1800000（30分钟） */
    refreshInterval?: number;
}
/**
 * BalanceService - HTTP 客户端
 *
 * 封装对 DeepSeek /user/balance API 的调用：Bearer Token 认证、单次请求、
 * 10 秒超时、无状态。
 */
export declare class BalanceService {
    static fetchBalance(apiKey: string): Promise<BalanceResponse>;
    /** 验证并规范化轮询间隔 */
    static normalizeInterval(interval?: number): number;
}
/**
 * BalanceViewModel - 状态管理与轮询调度
 *
 * - 管理余额状态（当前值 + 加载状态 + 错误状态）
 * - 定时轮询调度（启动/停止/重启）
 * - 容错：网络错误保留上次成功的数据（过期数据 > 没有数据）
 * - API Key 每次刷新按需读取，不持久化到内存
 */
export declare class BalanceViewModel {
    private _balance;
    private _loading;
    private _lastError;
    private _lastUpdateTime;
    private timer;
    private interval;
    private readonly ctx;
    private readonly apiKeyProvider;
    constructor(ctx: Context, options: {
        interval?: number;
        apiKeyProvider: () => string;
    });
    get balance(): BalanceResponse | null;
    get loading(): boolean;
    get lastError(): Error | null;
    get lastUpdateTime(): Date | null;
    get isAvailable(): boolean;
    get refreshInterval(): number;
    /** 执行一次余额查询并更新状态；失败时保留上次成功数据 */
    refresh(): Promise<void>;
    /** 启动自动轮询：立即执行第一次查询，之后按 interval 定时刷新 */
    startPolling(): void;
    stopPolling(): void;
    /** 重启轮询（用于配置变更，如修改了刷新间隔或 API Key） */
    restartPolling(newInterval?: number): void;
    /** 清理资源（插件卸载时调用） */
    dispose(): void;
}
/** 将余额数据格式化为人类可读文本 */
export declare function formatBalanceText(data: BalanceResponse): string;
/**
 * 插件主入口
 *
 * 初始化流程：
 * 1. 读取配置（第二参数，来自入口行 config，apiKey 回退到环境变量）
 * 2. 创建 ViewModel 实例
 * 3. 注册命令 /balance 与四个工具
 * 4. 配置了 API Key 时启动轮询（ctx.effect 管理生命周期）
 */
declare function apply(ctx: Context, config?: BalanceConfig): void;
declare const inject: string[];
declare const name = "plugin-balance";
export { apply, inject, name };
declare module '@deepseek-ai/cordis' {
    interface Context {
        commands: {
            register(definition: {
                name: string;
                description: string;
                input?: {
                    hint: string;
                };
                handler: (invocation: {
                    commandId: string;
                    rawInput: string;
                    signal: AbortSignal;
                }) => {
                    kind: 'success';
                    text?: string;
                } | {
                    kind: 'error';
                    text: string;
                } | Promise<{
                    kind: 'success';
                    text?: string;
                } | {
                    kind: 'error';
                    text: string;
                }>;
            }): () => void;
        };
    }
}
