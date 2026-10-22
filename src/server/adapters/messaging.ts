import { defaultFetch, requestJson, type FetchLike } from "./http";

// WhatsApp (and later SMS) adapter. WhatsApp Business Cloud API implementation.

export interface WhatsAppText {
  to: string;
  text: string;
}

export interface WhatsAppTemplate {
  to: string;
  template: string;
  language: string;
  /** Body parameters, in order. */
  parameters: string[];
}

export interface Messenger {
  readonly name: string;
  sendText(message: WhatsAppText): Promise<{ id: string }>;
  sendTemplate(message: WhatsAppTemplate): Promise<{ id: string }>;
}

/** Normalises Zimbabwean numbers to international format without '+': 0771234567 → 263771234567. */
export function toWhatsAppNumber(phone: string, defaultCountry = "263"): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return defaultCountry + digits.slice(1);
  if (digits.length === 9) return defaultCountry + digits;
  return digits;
}

export class WhatsAppCloudMessenger implements Messenger {
  readonly name = "whatsapp-cloud";
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly apiVersion = "v21.0",
    private readonly fetchImpl: FetchLike = defaultFetch(),
  ) {}

  sendText(message: WhatsAppText) {
    return this.post({
      messaging_product: "whatsapp",
      to: toWhatsAppNumber(message.to),
      type: "text",
      text: { body: message.text, preview_url: false },
    });
  }

  sendTemplate(message: WhatsAppTemplate) {
    return this.post({
      messaging_product: "whatsapp",
      to: toWhatsAppNumber(message.to),
      type: "template",
      template: {
        name: message.template,
        language: { code: message.language },
        components: [{ type: "body", parameters: message.parameters.map((text) => ({ type: "text", text })) }],
      },
    });
  }

  private async post(body: unknown): Promise<{ id: string }> {
    const reply = await requestJson<{ messages?: Array<{ id: string }> }>(
      this.fetchImpl,
      "WhatsApp",
      `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
      { method: "POST", headers: { authorization: `Bearer ${this.accessToken}` }, body },
    );
    return { id: reply.messages?.[0]?.id ?? "" };
  }
}

export class FakeMessenger implements Messenger {
  readonly name = "fake";
  readonly sent: Array<WhatsAppText | WhatsAppTemplate> = [];
  async sendText(message: WhatsAppText) {
    this.sent.push({ ...message, to: toWhatsAppNumber(message.to) });
    return { id: `fake-wa-${this.sent.length}` };
  }
  async sendTemplate(message: WhatsAppTemplate) {
    this.sent.push({ ...message, to: toWhatsAppNumber(message.to) });
    return { id: `fake-wa-${this.sent.length}` };
  }
}
