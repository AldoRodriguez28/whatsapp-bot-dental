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

describe('SchedulingService.bookAppointment', () => {
  function makeService(existing: any) {
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 'appt1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      patient: { upsert: jest.fn().mockResolvedValue({ id: 'p1' }) },
    } as any;
    const calendar = {
      createEvent: jest.fn().mockResolvedValue('evt1'),
      deleteEvent: jest.fn(),
    } as any;
    return { service: new SchedulingService(prisma, calendar), prisma, calendar };
  }

  it('rechaza si el slot ya está tomado', async () => {
    const { service } = makeService({ id: 'taken' });
    const res = await service.bookAppointment(clinic, {
      phone: '521', patientName: 'Ana', treatment: 'limpieza',
      startsAt: new Date('2026-06-29T15:00:00Z'),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('slot_taken');
  });

  it('crea paciente, cita y evento de Calendar cuando está libre', async () => {
    const { service, prisma, calendar } = makeService(null);
    const res = await service.bookAppointment(clinic, {
      phone: '521', patientName: 'Ana', treatment: 'limpieza',
      startsAt: new Date('2026-06-29T15:00:00Z'),
    });
    expect(res.ok).toBe(true);
    expect(prisma.patient.upsert).toHaveBeenCalled();
    expect(prisma.appointment.create).toHaveBeenCalled();
    expect(calendar.createEvent).toHaveBeenCalled();
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { googleEventId: 'evt1' } }),
    );
  });

  it('si Calendar falla, la cita igual queda creada (sin googleEventId)', async () => {
    const { service, calendar, prisma } = makeService(null);
    calendar.createEvent.mockRejectedValue(new Error('google down'));
    const res = await service.bookAppointment(clinic, {
      phone: '521', patientName: 'Ana', treatment: 'limpieza',
      startsAt: new Date('2026-06-29T15:00:00Z'),
    });
    expect(res.ok).toBe(true);
    expect(prisma.appointment.create).toHaveBeenCalled();
  });
});

describe('SchedulingService.cancelAppointment', () => {
  it('regresa not_found si no hay cita', async () => {
    const prisma = { appointment: { findFirst: jest.fn().mockResolvedValue(null) } } as any;
    const service = new SchedulingService(prisma, {} as any);
    const res = await service.cancelAppointment(clinic, { phone: '521' });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('marca cancelada y borra el evento', async () => {
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', googleEventId: 'evt1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const calendar = { deleteEvent: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new SchedulingService(prisma, calendar);
    const res = await service.cancelAppointment(clinic, { phone: '521' });
    expect(res.ok).toBe(true);
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelled' } }),
    );
    expect(calendar.deleteEvent).toHaveBeenCalledWith('cal1', 'evt1');
  });
});
