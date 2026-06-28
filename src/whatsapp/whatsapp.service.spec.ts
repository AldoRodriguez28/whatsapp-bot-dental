// src/whatsapp/whatsapp.service.spec.ts
import { WhatsappService } from './whatsapp.service';

const creds = { phoneNumberId: 'PN1', accessToken: 'TOK' };

describe('WhatsappService', () => {
  beforeEach(() => {
    process.env.TEST_MODE = 'false';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'm1' }] }),
    }) as any;
  });

  it('sendText usa el phoneNumberId y token de las credenciales', async () => {
    const service = new WhatsappService();
    await service.sendText(creds, '521', 'hola');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/PN1/messages');
    expect(opts.headers.Authorization).toBe('Bearer TOK');
  });

  it('respeta TEST_MODE sin llamar fetch', async () => {
    process.env.TEST_MODE = 'true';
    const service = new WhatsappService();
    const res = await service.sendText(creds, '521', 'hola');
    expect(res).toEqual({ ok: true, testMode: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sendList arma payload interactive type list', async () => {
    const service = new WhatsappService();
    await service.sendList(creds, '521', 'Elige', 'Ver horarios', [
      { id: 'h1', title: '09:00' },
    ]);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const payload = JSON.parse(opts.body);
    expect(payload.interactive.type).toBe('list');
    expect(payload.interactive.action.sections[0].rows[0].id).toBe('h1');
  });
});
