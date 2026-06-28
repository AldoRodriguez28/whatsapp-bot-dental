// src/reminders/reminders.service.spec.ts
import { RemindersService } from './reminders.service';

describe('RemindersService.runForToday', () => {
  function make(appointments: any[]) {
    const prisma = {
      clinic: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', timezone: 'America/Mexico_City', waPhoneNumberId: 'PN1', waAccessToken: 'TOK' },
      ]) },
      appointment: {
        findMany: jest.fn().mockResolvedValue(appointments),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const whatsapp = { sendButtons: jest.fn().mockResolvedValue({}) } as any;
    return { service: new RemindersService(prisma, whatsapp), prisma, whatsapp };
  }

  it('envía recordatorio con botones y marca reminderSentAt', async () => {
    const { service, whatsapp, prisma } = make([
      {
        id: 'a1', startsAt: new Date('2026-06-29T15:00:00Z'),
        patient: { phone: '521', name: 'Ana' }, treatment: 'limpieza',
      },
    ]);
    const res = await service.runForToday(new Date('2026-06-29T13:00:00Z'));
    expect(res.sent).toBe(1);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      { phoneNumberId: 'PN1', accessToken: 'TOK' },
      '521',
      expect.stringContaining('cita'),
      [
        { id: 'confirm_a1', title: 'Confirmar' },
        { id: 'cancel_a1', title: 'Cancelar' },
      ],
    );
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1' }, data: { reminderSentAt: expect.any(Date) } }),
    );
  });

  it('no envía nada si no hay citas hoy', async () => {
    const { service, whatsapp } = make([]);
    const res = await service.runForToday(new Date('2026-06-29T13:00:00Z'));
    expect(res.sent).toBe(0);
    expect(whatsapp.sendButtons).not.toHaveBeenCalled();
  });
});
