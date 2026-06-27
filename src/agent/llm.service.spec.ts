// src/agent/llm.service.spec.ts
import { LlmService } from './llm.service';
import { AgentContext } from './tools';
import { Clinic } from '@prisma/client';

const ctx: AgentContext = {
  clinic: { id: 'c1', name: 'Dental X', timezone: 'America/Mexico_City' } as unknown as Clinic,
  phone: '521',
};

describe('LlmService', () => {
  it('devuelve texto cuando Claude responde sin tools', async () => {
    const service = new LlmService({} as any);
    (service as any).client = {
      messages: {
        create: jest.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '¡Hola! ¿En qué te ayudo?' }],
        }),
      },
    };
    const out = await service.reply(ctx, 'hola');
    expect(out).toContain('Hola');
  });

  it('ejecuta una tool y vuelve a llamar al modelo', async () => {
    const scheduling = {
      getAvailability: jest.fn().mockResolvedValue([]),
    } as any;
    const service = new LlmService(scheduling);
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't1', name: 'get_availability', input: { date: '2026-06-29' } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'No hay horarios ese día.' }],
      });
    (service as any).client = { messages: { create } };
    const out = await service.reply(ctx, '¿hay espacio el lunes?');
    expect(create).toHaveBeenCalledTimes(2);
    expect(scheduling.getAvailability).toHaveBeenCalled();
    expect(out).toContain('No hay horarios');
  });
});
