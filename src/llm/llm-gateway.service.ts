import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIError } from 'openai';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/';

/** Default free Stepfun model on OpenRouter (override with OPEN_ROUTER_MODEL). */
export const OPENROUTER_DEFAULT_MODEL = 'stepfun/step-3.5-flash:free';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant for a unified commerce platform. Be concise, accurate, and grounded in the data provided.';

/** ms before an LLM request is aborted (free-tier models can queue for a long time). */
const DEFAULT_TIMEOUT_MS = 30_000;

export type LlmProvider = 'openrouter' | 'gemini';

/**
 * Single LLM entrypoint supporting OpenRouter and Google Gemini (direct).
 *
 * Set LLM_PROVIDER=gemini + GEMINI_API_KEY to use Gemini directly.
 * Set LLM_PROVIDER=openrouter (default) + OPEN_ROUTER_ENABLED=true + OPEN_ROUTER_API_KEY for OpenRouter.
 */
@Injectable()
export class LlmGatewayService implements OnModuleInit {
  private readonly logger = new Logger(LlmGatewayService.name);
  private readonly systemPrompt: string;
  private readonly enabled: boolean;
  private readonly model: string;
  private readonly provider: LlmProvider;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;
  private readonly client: OpenAI | null;

  constructor(private readonly config: ConfigService) {
    this.systemPrompt =
      this.config.get<string>('LLM_SYSTEM_PROMPT')?.trim() ||
      DEFAULT_SYSTEM_PROMPT;

    this.provider =
      (this.config
        .get<string>('LLM_PROVIDER')
        ?.trim()
        .toLowerCase() as LlmProvider) || 'openrouter';

    const rawTemp = this.config.get<string>('LLM_TEMPERATURE')?.trim();
    this.defaultTemperature =
      rawTemp && Number.isFinite(Number(rawTemp)) ? Number(rawTemp) : 0.1;

    const rawTokens = this.config.get<string>('LLM_MAX_TOKENS')?.trim();
    this.defaultMaxTokens =
      rawTokens && Number.isFinite(Number(rawTokens))
        ? Number(rawTokens)
        : 4096;

    const timeoutRaw = this.config.get<string>('LLM_TIMEOUT_MS')?.trim();
    const timeout =
      timeoutRaw && Number.isFinite(Number(timeoutRaw))
        ? Number(timeoutRaw)
        : DEFAULT_TIMEOUT_MS;

    if (this.provider === 'gemini') {
      const apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim();
      this.model =
        this.config.get<string>('GEMINI_MODEL')?.trim() || GEMINI_DEFAULT_MODEL;
      this.enabled = !!apiKey;
      this.client = apiKey
        ? new OpenAI({
            baseURL: GEMINI_BASE_URL,
            apiKey,
            maxRetries: 0,
            timeout,
          })
        : null;
    } else {
      const apiKey =
        this.config.get<string>('OPEN_ROUTER_API_KEY')?.trim() ||
        this.config.get<string>('OPENROUTER_API_KEY')?.trim();
      this.model =
        this.config.get<string>('OPEN_ROUTER_MODEL')?.trim() ||
        this.config.get<string>('OPENROUTER_MODEL')?.trim() ||
        OPENROUTER_DEFAULT_MODEL;
      this.enabled =
        this.config.get<string>('OPEN_ROUTER_ENABLED')?.trim() === 'true';
      const referer =
        this.config.get<string>('OPENROUTER_HTTP_REFERER')?.trim() ||
        'http://localhost';
      this.client =
        this.enabled && apiKey
          ? new OpenAI({
              baseURL: OPENROUTER_BASE_URL,
              apiKey,
              defaultHeaders: {
                'HTTP-Referer': referer,
                'X-Title': 'unified-commerce',
              },
              // Let the application layer own retry logic — SDK retries on 400/422
              // are useless (same deterministic error) and interfere with the manual
              // json-mode fallback below.
              maxRetries: 0,
              timeout,
            })
          : null;
    }
  }

  /** True when the configured LLM provider is ready. */
  get llmAvailable(): boolean {
    return this.client != null;
  }

  get defaultModel(): string {
    return this.model;
  }

  private formatApiErrorDetails(err: unknown): string {
    if (err instanceof APIError) {
      const details: string[] = [];
      if (err.status != null) details.push(`status=${err.status}`);
      if (err.name) details.push(`name=${err.name}`);
      if (err.code != null) details.push(`code=${String(err.code)}`);
      if (err.type) details.push(`type=${err.type}`);
      return details.length ? details.join(' ') : 'api_error';
    }
    return err instanceof Error ? err.name : 'unknown_error';
  }

  /**
   * Chat completion.
   *
   * Options:
   * - `model` — override the configured default model for this call
   * - `systemPrompt` — override the default system prompt
   * - `jsonMode` — request a JSON-only response; falls back to plain text if
   *   the model rejects `response_format` (400/422) and logs a warning
   * - `temperature` — override the default (env: LLM_TEMPERATURE, default 0.1)
   * - `maxTokens` — override the default (env: LLM_MAX_TOKENS, default 4096)
   */
  async generate(
    prompt: string,
    options?: {
      model?: string;
      systemPrompt?: string;
      jsonMode?: boolean;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<string> {
    if (!this.client) {
      const hint =
        this.provider === 'gemini'
          ? 'Set LLM_PROVIDER=gemini and GEMINI_API_KEY.'
          : 'Set OPEN_ROUTER_ENABLED=true and OPEN_ROUTER_API_KEY.';
      throw new Error(
        `LLM provider "${this.provider}" is not configured. ${hint}`,
      );
    }

    const model = options?.model ?? this.model;
    const system = options?.systemPrompt ?? this.systemPrompt;
    const temperature = options?.temperature ?? this.defaultTemperature;
    const max_tokens = options?.maxTokens ?? this.defaultMaxTokens;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];

    const run = async (jsonMode: boolean): Promise<string> => {
      let res: OpenAI.Chat.ChatCompletion;
      try {
        res = await this.client!.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens,
          ...(jsonMode
            ? { response_format: { type: 'json_object' as const } }
            : {}),
        });
      } catch (e) {
        const details = this.formatApiErrorDetails(e);
        const isRateLimit = e instanceof APIError && e.status === 429;
        if (isRateLimit) {
          this.logger.warn(
            `[llm] step=rate_limited model=${model} jsonMode=${jsonMode} ${details}: ${e instanceof Error ? e.message : String(e)}`,
          );
        } else {
          this.logger.error(
            `[llm] step=api_error model=${model} jsonMode=${jsonMode} ${details}: ${e instanceof Error ? e.message : String(e)}`,
            e instanceof Error ? e.stack : undefined,
          );
        }
        throw e;
      }

      // Log token usage on every completion for cost visibility.
      if (res.usage) {
        this.logger.log(
          `[llm] step=completion model=${model} ` +
            `prompt_tokens=${res.usage.prompt_tokens} ` +
            `completion_tokens=${res.usage.completion_tokens} ` +
            `total_tokens=${res.usage.total_tokens}`,
        );
      }

      const content = res.choices?.[0]?.message?.content?.trim();
      if (content == null || content === '') {
        throw new Error(`OpenRouter returned empty content (model=${model}).`);
      }
      return content;
    };

    if (options?.jsonMode) {
      try {
        return await run(true);
      } catch (e) {
        // Some OpenRouter models don't support response_format — fall back to plain
        // text and let the caller parse. Warn so this is visible in logs.
        const fallback =
          e instanceof APIError && (e.status === 400 || e.status === 422);
        if (fallback) {
          this.logger.warn(
            `[llm] json_object rejected by model=${model} (${e.status}); ` +
              'retrying without response_format — result may not be valid JSON',
          );
          return run(false);
        }
        throw e;
      }
    }

    return run(false);
  }

  async onModuleInit(): Promise<void> {
    if (this.client) {
      this.logger.log(
        `[llm] provider=${this.provider} model=${this.model} temperature=${this.defaultTemperature} maxTokens=${this.defaultMaxTokens}`,
      );
    } else {
      const hint =
        this.provider === 'gemini'
          ? 'set LLM_PROVIDER=gemini and GEMINI_API_KEY'
          : 'set OPEN_ROUTER_ENABLED=true and OPEN_ROUTER_API_KEY';
      this.logger.log(`[llm] disabled — ${hint} to enable LLM features`);
    }
  }
}
