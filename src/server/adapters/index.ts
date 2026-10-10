import { FakeAiAssistant, type AiAssistant } from "./ai";
import { FakeDomainProvider, VercelDomainProvider, type DomainProvider } from "./domains";
import { FakeEmailSender, ResendEmailSender, type EmailSender } from "./email";
import { FakeFiscalDevice, type FiscalDevice } from "./fiscal";
import { FakeMessenger, WhatsAppCloudMessenger, type Messenger } from "./messaging";
import { FakePaymentGateway } from "./payments/fake";
import { PaynowGateway } from "./payments/paynow";
import type { PaymentGateway } from "./payments/types";
import { MemoryFileStorage, type FileStorage } from "./storage";

// One place that decides which implementation each adapter uses, from
// environment variables only (no secrets in code). ADAPTERS=fake forces fakes
// everywhere (tests, demos); otherwise a real adapter is used when its
// configuration is present and a fake is used (with a warning) when it is not.

export interface Adapters {
  payments: Record<string, PaymentGateway>;
  email: EmailSender;
  messaging: Messenger;
  storage: FileStorage;
  domains: DomainProvider;
  fiscal: FiscalDevice;
  ai: AiAssistant;
  /** Services running on fakes because configuration is missing. */
  missing: string[];
}

type Env = Record<string, string | undefined>;

export function createAdapters(env: Env = process.env): Adapters {
  const forceFake = env.ADAPTERS === "fake";
  const missing: string[] = [];
  const real = <T>(service: string, keys: string[], make: () => T, fake: () => T): T => {
    if (!forceFake && keys.every((k) => env[k])) return make();
    if (!forceFake) missing.push(service);
    return fake();
  };

  return {
    payments: { paynow: forceFake ? new FakePaymentGateway() : new PaynowGateway({ baseUrl: env.PAYNOW_BASE_URL }) },
    email: real<EmailSender>("email", ["RESEND_API_KEY"], () => new ResendEmailSender(env.RESEND_API_KEY!), () => new FakeEmailSender()),
    messaging: real<Messenger>(
      "whatsapp",
      ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
      () => new WhatsAppCloudMessenger(env.WHATSAPP_ACCESS_TOKEN!, env.WHATSAPP_PHONE_NUMBER_ID!, env.WHATSAPP_API_VERSION),
      () => new FakeMessenger(),
    ),
    storage: new MemoryFileStorage(),
    domains: real<DomainProvider>(
      "domains",
      ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"],
      () => new VercelDomainProvider(env.VERCEL_TOKEN!, env.VERCEL_PROJECT_ID!, env.VERCEL_TEAM_ID),
      () => new FakeDomainProvider(),
    ),
    fiscal: new FakeFiscalDevice(),
    ai: new FakeAiAssistant(),
    missing,
  };
}
