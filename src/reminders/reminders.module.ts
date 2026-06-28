// src/reminders/reminders.module.ts
import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
