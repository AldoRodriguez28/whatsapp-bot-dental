import { WebhookService } from './webhook.service';

function payload(phoneNumberId: string, text: string) {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{ from: '521', type: 'text', text: { body: text } }],
        },
      }],
    }],
  };
}

describe('WebhookService.handleWebhookEvent', () => {
  function make(clinic: any) {
    const clinics = {
      extractPhoneNumberId: (b: any) => b?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
      findByPhoneNumberId: jest.fn().mockResolvedValue(clinic),
    } as any;
    const router = { handle: jest.fn() } as any;
    return { service: new WebhookService(clinics, router), router, clinics };
  }

  it('resuelve clínica y delega al router', async () => {
    const clinic = { id: 'c1' };
    const { service, router } = make(clinic);
    await service.handleWebhookEvent(payload('PN1', 'hola'));
    expect(router.handle).toHaveBeenCalledWith(clinic, '521', 'hola');
  });

  it('si no hay clínica, no llama al router', async () => {
    const { service, router } = make(null);
    await service.handleWebhookEvent(payload('PNX', 'hola'));
    expect(router.handle).not.toHaveBeenCalled();
  });

  it('ignora payloads sin mensaje', async () => {
    const { service, router } = make({ id: 'c1' });
    await service.handleWebhookEvent({ entry: [{ changes: [{ value: {} }] }] });
    expect(router.handle).not.toHaveBeenCalled();
  });
});
