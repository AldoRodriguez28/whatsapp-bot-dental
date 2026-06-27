// src/agent/tools.spec.ts
import { executeTool, toolDefinitions, AgentContext } from './tools';
import { Clinic } from '@prisma/client';

const ctx: AgentContext = {
  clinic: {
    id: 'c1', timezone: 'America/Mexico_City', slotMinutes: 30,
    pricesJson: { limpieza: 500 }, address: 'Calle 1',
  } as unknown as Clinic,
  phone: '521',
};

describe('agent tools', () => {
  it('expone 4 herramientas con input_schema', () => {
    expect(toolDefinitions.map((t) => t.name).sort()).toEqual(
      ['book_appointment', 'cancel_appointment', 'get_availability', 'get_clinic_info'].sort(),
    );
  });

  it('get_availability devuelve horarios formateados', async () => {
    const scheduling = {
      getAvailability: jest.fn().mockResolvedValue([
        { startsAt: new Date('2026-06-29T15:00:00Z'), endsAt: new Date('2026-06-29T15:30:00Z') },
      ]),
    } as any;
    const out = await executeTool('get_availability', { date: '2026-06-29' }, ctx, scheduling);
    expect(scheduling.getAvailability).toHaveBeenCalledWith(ctx.clinic, '2026-06-29');
    expect(out).toContain('09:00'); // 15:00 UTC = 09:00 CDMX
  });

  it('book_appointment reporta slot ocupado', async () => {
    const scheduling = {
      bookAppointment: jest.fn().mockResolvedValue({ ok: false, reason: 'slot_taken' }),
    } as any;
    const out = await executeTool(
      'book_appointment',
      { patientName: 'Ana', treatment: 'limpieza', dateTime: '2026-06-29T15:00:00Z' },
      ctx, scheduling,
    );
    expect(out.toLowerCase()).toContain('ocupado');
  });

  it('get_clinic_info responde precios desde config', async () => {
    const out = await executeTool('get_clinic_info', { topic: 'precios' }, ctx, {} as any);
    expect(out).toContain('limpieza');
  });

  it('valida input inválido', async () => {
    const out = await executeTool('get_availability', {}, ctx, {} as any);
    expect(out.toLowerCase()).toContain('error');
  });
});
