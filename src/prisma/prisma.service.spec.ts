// src/prisma/prisma.service.spec.ts
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('llama $connect en onModuleInit', async () => {
    const service = new PrismaService();
    const connectSpy = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined as never);
    await service.onModuleInit();
    expect(connectSpy).toHaveBeenCalled();
  });
});
