import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import OpenAI, { APIError } from 'openai';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const OPENROUTER_DEFAULT_MODEL = 'stepfun/step-3.5-flash:free';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant for a unified commerce platform. Be concise, accurate, and grounded in the data provided.';

const DEFAULT_TIMEOUT_MS = 30_000;

export type LlmProvider = 'openrouter' | 'gemini';

/**
 * Single LLM entrypoint supporting OpenRouter and Google Gemini (direct).
 *
 * Set LLM_PROVIDER=gemini + GEMINI_API_KEY to use Gemini via @google/genai.
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
  private readonly timeoutMs: number;

  // Exactly one of these is set depending on provider
  private readonly geminiClient: GoogleGenAI | null = null;
  private readonly openrouterClient: OpenAI | null = null;

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
      rawTokens && Number.isFinite(Number(rawTokens)) ? Number(rawTokens) : 4096;

    const timeoutRaw = this.config.get<string>('LLM_TIMEOUT_MS')?.trim();
    this.timeoutMs =
      timeoutRaw && Number.isFinite(Number(timeoutRaw))
        ? Number(timeoutRaw)
        : DEFAULT_TIMEOUT_MS;

    if (this.provider === 'gemini') {
      const apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim();
      this.model =
        this.config.get<string>('GEMINI_MODEL')?.trim() || GEMINI_DEFAULT_MODEL;
      this.enabled = !!apiKey;
      this.geminiClient = apiKey ? new GoogleGenAI({ apiKey }) : null;
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
      this.openrouterClient =
        this.enabled && apiKey
          ? new OpenAI({
              baseURL: OPENROUTER_BASE_URL,
              apiKey,
              defaultHeaders: {
                'HTTP-Referer': referer,
                'X-Title': 'unified-commerce',
              },
              maxRetries: 0,
              timeout: this.timeoutMs,
            })
          : null;
    }
  }

  get llmAvailable(): boolean {
    return this.provider === 'gemini'
      ? this.geminiClient !== null
      : this.openrouterClient !== null;
  }

  get defaultModel(): string {
    return this.model;
  }

  /**
   * Chat completion.
   *
   * Options:
   * - `model` — override the configured default for this call
   * - `systemPrompt` — override the default system prompt
   * - `jsonMode` — request a JSON-only response
   * - `temperature` / `maxTokens` — per-call overrides
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
    if (!this.llmAvailable) {
      const hint =
        this.provider === 'gemini'
          ? 'Set LLM_PROVIDER=gemini and GEMINI_API_KEY.'
          : 'Set OPEN_ROUTER_ENABLED=true and OPEN_ROUTER_API_KEY.';
      throw new Error(
        `LLM provider "${this.provider}" is not configured. ${hint}`,
      );
    }

    return this.provider === 'gemini'
      ? this.generateWithGemini(prompt, options)
      : this.generateWithOpenRouter(prompt, options);
  }

  // ── Gemini ─────────────────────────────────────────────────────────────────

  private async generateWithGemini(
    prompt: string,
    options?: {
      model?: string;
      systemPrompt?: string;
      jsonMode?: boolean;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<string> {
    const client = this.geminiClient!;
    const model = options?.model ?? this.model;
    const system = options?.systemPrompt ?? this.systemPrompt;
    const temperature = options?.temperature ?? this.defaultTemperature;
    const maxOutputTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const jsonMode = options?.jsonMode ?? false;

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: system,
          temperature,
          maxOutputTokens,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      });

      const text = response.text?.trim();
      if (!text) {
        const finishReason = response.candidates?.[0]?.finishReason ?? 'unknown';
        // Common causes: SAFETY (content filtered), MAX_TOKENS (response truncated),
        // RECITATION (training data refusal). Caller (ScrapeRefinementService) falls back gracefully.
        this.logger.warn(
          `[llm] step=empty_content provider=gemini model=${model} finishReason=${String(finishReason)}`,
        );
        throw new Error(`Gemini returned empty content (model=${model} finishReason=${String(finishReason)})`);
      }

      const usage = response.usageMetadata;
      if (usage) {
        this.logger.log(
          `[llm] step=completion provider=gemini model=${model} ` +
            `prompt_tokens=${usage.promptTokenCount ?? 0} ` +
            `completion_tokens=${usage.candidatesTokenCount ?? 0} ` +
            `total_tokens=${usage.totalTokenCount ?? 0}`,
        );
      }

      return text;
    } catch (e) {
      const isAbort =
        e instanceof Error &&
        (e.name === 'AbortError' || e.message.includes('abort'));
      if (isAbort) {
        this.logger.error(
          `[llm] step=timeout provider=gemini model=${model} timeoutMs=${this.timeoutMs}`,
        );
        throw new Error(`Gemini request timed out after ${this.timeoutMs}ms`);
      }
      // Empty-content errors are already logged at warn level above.
      const alreadyLogged = e instanceof Error && e.message.startsWith('Gemini returned empty content');
      if (!alreadyLogged) {
        this.logger.error(
          `[llm] step=api_error provider=gemini model=${model}: ${e instanceof Error ? e.message : String(e)}`,
          e instanceof Error ? e.stack : undefined,
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── OpenRouter ─────────────────────────────────────────────────────────────

  private async generateWithOpenRouter(
    prompt: string,
    options?: {
      model?: string;
      systemPrompt?: string;
      jsonMode?: boolean;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<string> {
    const client = this.openrouterClient!;
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
        res = await client.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens,
          ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        });
      } catch (e) {
        const isRateLimit = e instanceof APIError && e.status === 429;
        if (isRateLimit) {
          this.logger.warn(
            `[llm] step=rate_limited provider=openrouter model=${model} jsonMode=${jsonMode}: ${e instanceof Error ? e.message : String(e)}`,
          );
        } else {
          this.logger.error(
            `[llm] step=api_error provider=openrouter model=${model} jsonMode=${jsonMode}: ${e instanceof Error ? e.message : String(e)}`,
            e instanceof Error ? e.stack : undefined,
          );
        }
        throw e;
      }

      if (res.usage) {
        this.logger.log(
          `[llm] step=completion provider=openrouter model=${model} ` +
            `prompt_tokens=${res.usage.prompt_tokens} ` +
            `completion_tokens=${res.usage.completion_tokens} ` +
            `total_tokens=${res.usage.total_tokens}`,
        );
      }

      const content = res.choices?.[0]?.message?.content?.trim();
      if (content == null || content === '') {
        throw new Error(`OpenRouter returned empty content (model=${model})`);
      }
      return content;
    };

    if (options?.jsonMode) {
      try {
        return await run(true);
      } catch (e) {
        // Some OpenRouter models reject response_format — fall back to plain text.
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
    if (this.llmAvailable) {
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
