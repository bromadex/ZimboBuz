// AI adapter. Interface only for now; the AI epic (#16) implements it on the
// AI safety foundation (#77): the model may only call read-only,
// permission-checked tools that run as the signed-in user.

export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
  /** Runs as the asking user; must be read-only. */
  run(input: unknown): Promise<unknown>;
}

export interface AiAnswer {
  text: string;
  toolCalls: Array<{ name: string; input: unknown }>;
}

export interface AiAssistant {
  readonly name: string;
  ask(question: string, tools: AiTool[], context?: { page?: string }): Promise<AiAnswer>;
}

export class FakeAiAssistant implements AiAssistant {
  readonly name = "fake";
  async ask(question: string): Promise<AiAnswer> {
    return { text: `You asked: ${question}`, toolCalls: [] };
  }
}
