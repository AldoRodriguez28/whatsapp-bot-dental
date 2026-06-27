// src/agent/llm.service.ts
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AgentContext, toolDefinitions, executeTool } from './tools';

@Injectable()
export class LlmService {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';

  constructor(private readonly scheduling: SchedulingService) {}

  private systemPrompt(ctx: AgentContext, recentName?: string): string {
    const now = new Intl.DateTimeFormat('es-MX', {
      timeZone: ctx.clinic.timezone, dateStyle: 'full', timeStyle: 'short',
    }).format(new Date());
    return [
      `Eres el asistente de WhatsApp de ${ctx.clinic.name}, una clínica dental.`,
      `Hablas español de México, cálido y breve. Fecha/hora actual: ${now} (${ctx.clinic.timezone}).`,
      recentName ? `El paciente se llama ${recentName}.` : '',
      'Reglas: nunca inventes horarios; usa get_availability antes de ofrecer huecos.',
      'Antes de agendar confirma tratamiento, nombre y horario. Usa las herramientas para todo.',
      'Si el paciente pide precios/dirección/horarios usa get_clinic_info.',
    ].filter(Boolean).join(' ');
  }

  async reply(ctx: AgentContext, userMessage: string, recentName?: string): Promise<string> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    for (let i = 0; i < 5; i++) {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: this.systemPrompt(ctx, recentName),
        tools: toolDefinitions as any,
        messages,
      });

      if (res.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: res.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of res.content) {
          if (block.type === 'tool_use') {
            const result = await executeTool(block.name, block.input, ctx, this.scheduling);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return text || 'Disculpa, ¿me lo puedes repetir?';
    }
    return 'Disculpa, hubo un problema procesando tu mensaje. Escribe *menu* para opciones.';
  }
}
