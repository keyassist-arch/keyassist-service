import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIError } from 'openai';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Default free Stepfun model on OpenRouter (override with OPEN_ROUTER_MODEL). */
export const OPENROUTER_DEFAULT_MODEL = 'stepfun/step-3.5-flash:free';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant for a unified commerce platform. Be concise, accurate, and grounded in the data provided.';

/**
 * Single LLM entrypoint: **OpenRouter only** (Stepfun flash by default).
 * Set OPEN_ROUTER_ENABLED=true and OPEN_ROUTER_API_KEY.
 */
@Injectable()
export class LlmGatewayService implements OnModuleInit {
  private readonly logger = new Logger(LlmGatewayService.name);
  private readonly systemPrompt: string;
  private readonly enabled: boolean;
  private readonly model: string;
  private readonly client: OpenAI | null;

  constructor(private readonly config: ConfigService) {
    this.systemPrompt =
      this.config.get<string>('LLM_SYSTEM_PROMPT')?.trim() ||
      DEFAULT_SYSTEM_PROMPT;

    this.enabled =
      this.config.get<string>('OPEN_ROUTER_ENABLED')?.trim() === 'true';

    const apiKey =
      this.config.get<string>('OPEN_ROUTER_API_KEY')?.trim() ||
      this.config.get<string>('OPENROUTER_API_KEY')?.trim();

    this.model =
      this.config.get<string>('OPEN_ROUTER_MODEL')?.trim() ||
      this.config.get<string>('OPENROUTER_MODEL')?.trim() ||
      OPENROUTER_DEFAULT_MODEL;

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
            maxRetries: 1,
          })
        : null;
  }

  /** True when OpenRouter is configured and enabled. */
  get llmAvailable(): boolean {
    return this.client != null;
  }

  get defaultModel(): string {
    return this.model;
  }

  /**
   * Chat completion. Use `jsonMode: true` for JSON-only responses; on 400 from the model,
   * retries once without `response_format`.
   */
  async generate(
    prompt: string,
    options?: {
      model?: string;
      systemPrompt?: string;
      jsonMode?: boolean;
    },
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        'OpenRouter is not configured. Set OPEN_ROUTER_ENABLED=true and OPEN_ROUTER_API_KEY.',
      );
    }

    const model = options?.model ?? this.model;
    const system = options?.systemPrompt ?? this.systemPrompt;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];

    const run = async (jsonMode: boolean) => {
      const res = await this.client!.chat.completions.create({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 4096,
        ...(jsonMode
          ? { response_format: { type: 'json_object' as const } }
          : {}),
      });
      const content = res.choices?.[0]?.message?.content?.trim();
      if (content == null || content === '') {
        throw new Error('OpenRouter returned empty content.');
      }
      return content;
    };

    if (options?.jsonMode) {
      try {
        return await run(true);
      } catch (e) {
        const retry =
          e instanceof APIError &&
          (e.status === 400 || e.status === 422);
        if (retry) {
          this.logger.warn(
            '[llm] json_object rejected by model; retrying without response_format',
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
        `OpenRouter enabled (model: ${this.model}).`,
      );
    }
  }
}
