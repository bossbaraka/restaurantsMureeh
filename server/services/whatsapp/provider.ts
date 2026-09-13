import { config } from '../../config';
import { decryptToken } from './encryption';

/**
 * Dedicated WhatsApp Cloud API client abstraction.
 * No Meta Graph API calls should exist outside this module.
 */

export interface WhatsAppProviderConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  wabaId?: string;
}

export interface SendTemplateParams {
  to: string; // E.164
  templateName: string;
  languageCode: string;
  variables: string[]; // ordered variables for {{1}}, {{2}}, etc.
  // Optional header/body customization
  headerParams?: string[];
}

export interface SendTextParams {
  to: string;
  text: string;
}

export interface WhatsAppSendResult {
  messageId: string;
  raw: any;
}

export enum WhatsAppErrorType {
  INVALID_RECIPIENT = 'INVALID_RECIPIENT',
  INVALID_TOKEN = 'INVALID_TOKEN',
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SERVER_ERROR = 'SERVER_ERROR',
  MALFORMED_RESPONSE = 'MALFORMED_RESPONSE',
  UNKNOWN = 'UNKNOWN',
}

export class WhatsAppError extends Error {
  public readonly type: WhatsAppErrorType;
  public readonly statusCode?: number;
  public readonly raw?: any;
  public readonly retryable: boolean;

  constructor(
    message: string,
    type: WhatsAppErrorType,
    opts?: { statusCode?: number; raw?: any; retryable?: boolean }
  ) {
    super(message);
    this.name = 'WhatsAppError';
    this.type = type;
    this.statusCode = opts?.statusCode;
    this.raw = opts?.raw;
    this.retryable = opts?.retryable ?? false;
  }
}

export class WhatsAppProvider {
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;

  constructor(cfg: WhatsAppProviderConfig) {
    if (!cfg.phoneNumberId) throw new Error('phoneNumberId is required');
    if (!cfg.accessToken) throw new Error('accessToken is required');
    this.phoneNumberId = cfg.phoneNumberId;
    // Decrypt if needed (supports both encrypted and plaintext)
    try {
      this.accessToken = decryptToken(cfg.accessToken);
    } catch {
      this.accessToken = cfg.accessToken;
    }
    this.apiVersion = cfg.apiVersion || config.whatsappApiVersion || 'v21.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Send a template message.
   * Example payload for Meta Cloud API:
   * {
   *   messaging_product: "whatsapp",
   *   to: "970599123456",
   *   type: "template",
   *   template: {
   *     name: "order_ready",
   *     language: { code: "ar" },
   *     components: [{ type: "body", parameters: [{ type: "text", text: "Ahmed" }, ...] }]
   *   }
   * }
   */
  async sendTemplate(params: SendTemplateParams): Promise<WhatsAppSendResult> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;

    // Build components
    const bodyParameters = params.variables.map((v) => ({
      type: 'text',
      text: String(v).slice(0, 1024), // Meta limits
    }));

    const components: any[] = [];
    if (bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParameters,
      });
    }
    if (params.headerParams && params.headerParams.length > 0) {
      components.unshift({
        type: 'header',
        parameters: params.headerParams.map((v) => ({ type: 'text', text: String(v).slice(0, 1024) })),
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: params.to.replace('+', ''), // Meta expects number without + (some docs say with +, but without is more compatible)
      type: 'template',
      template: {
        name: params.templateName,
        language: {
          code: params.languageCode,
        },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    return this.request(url, payload);
  }

  async sendText(params: SendTextParams): Promise<WhatsAppSendResult> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: params.to.replace('+', ''),
      type: 'text',
      text: {
        body: params.text,
      },
    };
    return this.request(url, payload);
  }

  private async request(url: string, payload: any): Promise<WhatsAppSendResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000); // 15s timeout

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const raw = await this.safeParseJson(res);

      if (!res.ok) {
        throw this.mapError(res.status, raw);
      }

      // Expected response: { messaging_product, contacts, messages: [{ id, message_status }] }
      const messageId = raw?.messages?.[0]?.id || raw?.messages?.[0]?.message_status || null;
      if (!messageId) {
        // Sometimes API returns success without messages array? Treat as malformed but not fatal if status 200
        // We still return raw for tracing
        if (raw?.messages && raw.messages.length === 0) {
          throw new WhatsAppError('Malformed provider response: empty messages array', WhatsAppErrorType.MALFORMED_RESPONSE, {
            statusCode: res.status,
            raw,
            retryable: false,
          });
        }
        // Fallback: generate a pseudo id from timestamp if missing (should not happen)
        return {
          messageId: `wamid.unknown-${Date.now()}`,
          raw,
        };
      }

      return {
        messageId: String(messageId),
        raw,
      };
    } catch (err: any) {
      if (err instanceof WhatsAppError) throw err;
      if (err?.name === 'AbortError') {
        throw new WhatsAppError('WhatsApp API request timeout', WhatsAppErrorType.TIMEOUT, {
          retryable: true,
        });
      }
      // Network errors
      throw new WhatsAppError(`Network error: ${err?.message || 'unknown'}`, WhatsAppErrorType.NETWORK_ERROR, {
        raw: err,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async safeParseJson(res: Response): Promise<any> {
    try {
      const text = await res.text();
      if (!text) return {};
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  private mapError(status: number, raw: any): WhatsAppError {
    const errorCode = raw?.error?.code;
    const errorSubcode = raw?.error?.error_subcode;
    const errorMessage = raw?.error?.message || raw?.error?.error_user_msg || `WhatsApp API error ${status}`;
    const fbtrace = raw?.error?.fbtrace_id;

    // Log sanitized error (never log token)
    // console.error(`[WhatsAppProvider] API error ${status}: ${errorMessage} code=${errorCode} subcode=${errorSubcode} fbtrace=${fbtrace}`);

    if (status === 400) {
      // Could be invalid recipient, template, etc.
      const msgLower = String(errorMessage).toLowerCase();
      if (msgLower.includes('invalid') && (msgLower.includes('phone') || msgLower.includes('recipient') || msgLower.includes('to'))) {
        return new WhatsAppError(errorMessage, WhatsAppErrorType.INVALID_RECIPIENT, {
          statusCode: status,
          raw,
          retryable: false,
        });
      }
      if (msgLower.includes('template')) {
        return new WhatsAppError(errorMessage, WhatsAppErrorType.INVALID_TEMPLATE, {
          statusCode: status,
          raw,
          retryable: false,
        });
      }
      return new WhatsAppError(errorMessage, WhatsAppErrorType.UNKNOWN, {
        statusCode: status,
        raw,
        retryable: false,
      });
    }

    if (status === 401) {
      return new WhatsAppError('Invalid or expired access token', WhatsAppErrorType.INVALID_TOKEN, {
        statusCode: status,
        raw,
        retryable: false,
      });
    }

    if (status === 403) {
      return new WhatsAppError('Permission denied - check business verification and phone number ownership', WhatsAppErrorType.PERMISSION_DENIED, {
        statusCode: status,
        raw,
        retryable: false,
      });
    }

    if (status === 404) {
      return new WhatsAppError('Phone number ID or template not found', WhatsAppErrorType.INVALID_TEMPLATE, {
        statusCode: status,
        raw,
        retryable: false,
      });
    }

    if (status === 429) {
      return new WhatsAppError('Rate limited by WhatsApp API', WhatsAppErrorType.RATE_LIMITED, {
        statusCode: status,
        raw,
        retryable: true,
      });
    }

    if (status >= 500) {
      return new WhatsAppError(`WhatsApp server error ${status}`, WhatsAppErrorType.SERVER_ERROR, {
        statusCode: status,
        raw,
        retryable: true,
      });
    }

    return new WhatsAppError(errorMessage, WhatsAppErrorType.UNKNOWN, {
      statusCode: status,
      raw,
      retryable: false,
    });
  }

  /**
   * Factory: create provider from restaurant integration or global fallback.
   * This is the main entry point for multi-tenant usage.
   */
  static fromIntegration(integration: {
    phoneNumberId?: string | null;
    accessToken?: string | null;
    wabaId?: string | null;
  }): WhatsAppProvider | null {
    const phoneNumberId = integration.phoneNumberId || config.whatsappPhoneNumberId;
    const accessToken = integration.accessToken || config.whatsappAccessToken;
    const apiVersion = config.whatsappApiVersion || 'v21.0';

    if (!phoneNumberId || !accessToken) return null;

    return new WhatsAppProvider({
      phoneNumberId,
      accessToken,
      apiVersion,
      wabaId: integration.wabaId || config.whatsappWabaId || undefined,
    });
  }

  static fromGlobalConfig(): WhatsAppProvider | null {
    if (!config.whatsappPhoneNumberId || !config.whatsappAccessToken) return null;
    return new WhatsAppProvider({
      phoneNumberId: config.whatsappPhoneNumberId,
      accessToken: config.whatsappAccessToken,
      apiVersion: config.whatsappApiVersion,
      wabaId: config.whatsappWabaId || undefined,
    });
  }
}
