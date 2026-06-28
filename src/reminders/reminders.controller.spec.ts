// src/reminders/reminders.controller.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { RemindersController } from './reminders.controller';

describe('RemindersController', () => {
  const service = { runForToday: jest.fn().mockResolvedValue({ sent: 2 }) } as any;
  const controller = new RemindersController(service);

  beforeEach(() => { process.env.REMINDERS_TOKEN = 'secret'; });

  it('rechaza sin token válido', async () => {
    await expect(controller.run('Bearer wrong')).rejects.toThrow(UnauthorizedException);
  });

  it('corre con token correcto', async () => {
    const res = await controller.run('Bearer secret');
    expect(res).toEqual({ sent: 2 });
  });
});
