import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { ClinicsModule } from '../clinics/clinics.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [ClinicsModule, AgentModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
