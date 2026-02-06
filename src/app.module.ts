import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebhookModule } from './webhook/webhook.module';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [WebhookModule, WhatsappModule],
  controllers: [AppController],
  providers: [AppService, WhatsappService],
})
export class AppModule {}
