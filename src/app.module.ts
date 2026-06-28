import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ClinicsModule } from './clinics/clinics.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { SessionModule } from './session/session.module';
import { AgentModule } from './agent/agent.module';
import { WebhookModule } from './webhook/webhook.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { RemindersModule } from './reminders/reminders.module';

@Module({
  imports: [
    PrismaModule,
    ClinicsModule,
    SchedulingModule,
    SessionModule,
    AgentModule,
    WhatsappModule,
    WebhookModule,
    RemindersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
