// src/agent/router.service.ts
import { Injectable } from '@nestjs/common';
import { Clinic } from '@prisma/client';
import { WhatsappService, WaCredentials } from '../whatsapp/whatsapp.service';
import { LlmService } from './llm.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { SessionService } from '../session/session.service';

const MENU = `Hola 👋 Soy el asistente de la clínica 🦷
Puedo ayudarte a:
• *Agendar* una cita (escríbeme qué necesitas y qué día)
• Ver *precios*
• Conocer la *ubicación*
Cuéntame, ¿en qué te ayudo?`;

@Injectable()
export class RouterService {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly llm: LlmService,
    private readonly scheduling: SchedulingService,
    private readonly session: SessionService,
  ) {}

  private creds(clinic: Clinic): WaCredentials {
    return { phoneNumberId: clinic.waPhoneNumberId, accessToken: clinic.waAccessToken };
  }

  async handle(clinic: Clinic, from: string, text: string): Promise<void> {
    const creds = this.creds(clinic);
    const normalized = text.trim().toLowerCase();

    // Botones de recordatorio
    if (normalized.startsWith('confirm_')) {
      await this.whatsapp.sendText(creds, from, '¡Gracias! Tu cita queda confirmed ✅ Te esperamos.');
      return;
    }
    if (normalized.startsWith('cancel_')) {
      await this.scheduling.cancelAppointment(clinic, { phone: from });
      await this.whatsapp.sendText(creds, from, 'Listo, cancelé tu cita. Cuando quieras agendamos otra 🙂');
      return;
    }

    // Reglas triviales
    if (normalized === 'hola' || normalized === 'menu') {
      await this.whatsapp.sendText(creds, from, MENU);
      return;
    }

    // Texto libre → IA
    const reply = await this.llm.reply({ clinic, phone: from }, text);
    await this.whatsapp.sendText(creds, from, reply);
  }
}
