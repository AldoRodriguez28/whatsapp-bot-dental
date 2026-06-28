import { Module } from '@nestjs/common';
import { ClinicsService } from './clinics.service';

@Module({
  providers: [ClinicsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
