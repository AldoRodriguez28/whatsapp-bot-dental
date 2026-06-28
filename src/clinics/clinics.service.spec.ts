import { ClinicsService } from './clinics.service';

describe('ClinicsService', () => {
  const prisma = { clinic: { findUnique: jest.fn() } } as any;
  const service = new ClinicsService(prisma);

  it('extractPhoneNumberId lee metadata del payload', () => {
    const body = {
      entry: [
        { changes: [{ value: { metadata: { phone_number_id: '123' } } }] },
      ],
    };
    expect(service.extractPhoneNumberId(body)).toBe('123');
  });

  it('extractPhoneNumberId regresa undefined si falta', () => {
    expect(service.extractPhoneNumberId({})).toBeUndefined();
  });

  it('findByPhoneNumberId consulta por waPhoneNumberId', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'c1' });
    const clinic = await service.findByPhoneNumberId('123');
    expect(prisma.clinic.findUnique).toHaveBeenCalledWith({
      where: { waPhoneNumberId: '123' },
    });
    expect(clinic).toEqual({ id: 'c1' });
  });
});
