// src/scheduling/scheduling.module.ts
import { Module } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { GoogleCalendarClient } from './google-calendar.client';

@Module({
  providers: [SchedulingService, GoogleCalendarClient],
  exports: [SchedulingService],
})
export class SchedulingModule {}
