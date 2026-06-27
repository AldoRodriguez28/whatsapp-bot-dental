import { Injectable } from '@nestjs/common';
import { Clinic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClinicsService {
  constructor(private readonly prisma: PrismaService) {}

  extractPhoneNumberId(webhookBody: any): string | undefined {
    return webhookBody?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  }

  findByPhoneNumberId(phoneNumberId: string): Promise<Clinic | null> {
    return this.prisma.clinic.findUnique({
      where: { waPhoneNumberId: phoneNumberId },
    });
  }
}
