// src/agent/router.service.spec.ts
import { RouterService } from './router.service';
import { Clinic } from '@prisma/client';

const clinic = {
  id: 'c1', name: 'Dental X', waPhoneNumberId: 'PN1', waAccessToken: 'TOK',
} as unknown as Clinic;

function make() {
  const whatsapp = { sendText: jest.fn(), sendButtons: jest.fn() } as any;
  const llm = { reply: jest.fn().mockResolvedValue('respuesta IA') } as any;
  const scheduling = { cancelAppointment: jest.fn().mockResolvedValue({ ok: true }) } as any;
  const session = { get: jest.fn(), set: jest.fn(), clear: jest.fn() } as any;
  const router = new RouterService(whatsapp, llm, scheduling, session);
  return { router, whatsapp, llm, scheduling };
}

describe('RouterService', () => {
  it('responde menú a "hola"', async () => {
    const { router, whatsapp, llm } = make();
    await router.handle(clinic, '521', 'hola');
    expect(whatsapp.sendText).toHaveBeenCalled();
    expect(llm.reply).not.toHaveBeenCalled();
  });

  it('texto libre va a la IA', async () => {
    const { router, whatsapp, llm } = make();
    await router.handle(clinic, '521', 'me duele una muela, ¿hay hoy?');
    expect(llm.reply).toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      { phoneNumberId: 'PN1', accessToken: 'TOK' }, '521', 'respuesta IA',
    );
  });

  it('botón cancel_<id> cancela la cita', async () => {
    const { router, scheduling, whatsapp } = make();
    await router.handle(clinic, '521', 'cancel_appt9');
    expect(scheduling.cancelAppointment).toHaveBeenCalledWith(clinic, { phone: '521' });
    expect(whatsapp.sendText).toHaveBeenCalled();
  });

  it('botón confirm_<id> confirma', async () => {
    const { router, whatsapp } = make();
    await router.handle(clinic, '521', 'confirm_appt9');
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      expect.anything(), '521', expect.stringContaining('confirm'),
    );
  });
});
