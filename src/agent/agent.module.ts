// src/agent/agent.module.ts
import { Module } from '@nestjs/common';
import { RouterService } from './router.service';
import { LlmService } from './llm.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [WhatsappModule, SchedulingModule, SessionModule],
  providers: [RouterService, LlmService],
  exports: [RouterService],
})
export class AgentModule {}
