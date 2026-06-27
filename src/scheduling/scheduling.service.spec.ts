// src/scheduling/scheduling.service.spec.ts
import { SchedulingService } from './scheduling.service';
import { Clinic } from '@prisma/client';

const clinic = {
  id: 'c1',
  timezone: 'America/Mexico_City',
  slotMinutes: 30,
  googleCalendarId: 'cal1',
  workingHours: { '1': { open: '09:00', close: '11:00' } },
} as unknown as Clinic;

function makeService(busy: any[], appointments: any[]) {
  const prisma = {
    appointment: { findMany: jest.fn().mockResolvedValue(appointments) },
  } as any;
  const calendar = { getBusy: jest.fn().mockResolvedValue(busy) } as any;
  return new SchedulingService(prisma, calendar);
}

describe('SchedulingService.getAvailability', () => {
  // 2026-06-29 es lunes (weekday 1)
  it('devuelve todos los slots cuando el día está libre', async () => {
    const service = makeService([], []);
    const slots = await service.getAvailability(clinic, '2026-06-29');
    // 09:00-11:00 en slots de 30min = 4 slots
    expect(slots).toHaveLength(4);
  });

  it('excluye un slot ocupado por una cita en DB', async () => {
    const start = new Date('2026-06-29T15:00:00Z'); // 09:00 CDMX (UTC-6)
    const end = new Date('2026-06-29T15:30:00Z');
    const service = makeService([], [{ startsAt: start, endsAt: end }]);
    const slots = await service.getAvailability(clinic, '2026-06-29');
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.startsAt.getTime() === start.getTime())).toBe(false);
  });

  it('excluye un slot ocupado por busy del Calendar', async () => {
    const start = new Date('2026-06-29T15:30:00Z');
    const end = new Date('2026-06-29T16:00:00Z');
    const service = makeService([{ start, end }], []);
    const slots = await service.getAvailability(clinic, '2026-06-29');
    expect(slots).toHaveLength(3);
  });

  it('devuelve vacío en día sin horario (domingo)', async () => {
    const service = makeService([], []);
    const slots = await service.getAvailability(clinic, '2026-06-28'); // domingo
    expect(slots).toHaveLength(0);
  });
});
