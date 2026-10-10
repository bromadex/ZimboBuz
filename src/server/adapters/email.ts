import { defaultFetch, requestJson, type FetchLike } from "./http";

// Email adapter. Resend now; Microsoft Graph (sending from the company's own
// mailbox) arrives with the Microsoft 365 work in Wave 2 (§10.1).

export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; contentBase64: string }>;
}

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

export class ResendEmailSender implements EmailSender {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = defaultFetch(),
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    if (!message.html && !message.text) throw new Error("An email needs HTML or text content");
    const reply = await requestJson<{ id: string }>(this.fetchImpl, "Resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: {
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
        attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.contentBase64 })),
      },
    });
    return { id: reply.id };
  }
}

export class FakeEmailSender implements EmailSender {
  readonly name = "fake";
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    return { id: `fake-email-${this.sent.length}` };
  }
}
