import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class WebhookService {
  constructor(private readonly whatsapp: WhatsappService) {}

  verifySignature(req: Request & { rawBody?: Buffer }, signature256?: string) {
    const appSecret = process.env.APP_SECRET ?? process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) return;
    if (!signature256) throw new Error('Missing signature header');

    const [algo, hash] = signature256.split('=');
    if (algo !== 'sha256' || !hash) throw new Error('Invalid signature format');

    const payload = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(hash, 'hex');
    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new Error('Invalid signature');
    }
  }

  async handleWebhookEvent(body: any) {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];

    if (!msg) return;

    const from = msg.from;
    const text =
      msg.text?.body ||
      msg.interactive?.button_reply?.id ||
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.id ||
      msg.interactive?.list_reply?.title ||
      '';

    console.log('[INCOMING]', { from, text });

    const normalized = text.trim().toLowerCase();

    // ✅ Responder MENÚ al primer mensaje / o cuando escriba "menu"
    if (normalized === 'hola' || normalized === 'menu') {
      await this.whatsapp.sendText(from,
`Hola 👋
Gracias por contactar a *Clínica Dental Viridiana Segura* 🦷

Puedo ayudarte con:
1️⃣ Agendar una cita
2️⃣ Atención por dolor o urgencia
3️⃣ Información de precios
4️⃣ Ubicación y horarios

Responde con el número 🙂`);
      return;
    }

    if (normalized === '1') {
      await this.whatsapp.sendText(
        from,
        'Perfecto ✅ ¿Qué día y hora te gustaría para tu cita? También dime el tratamiento.',
      );
      return;
    }

    if (normalized === '2') {
      await this.whatsapp.sendButtons(from, 'Lamento la molestia 😥 ¿Qué tan fuerte es?', [
        { id: 'pain_leve', title: 'Leve' },
        { id: 'pain_moderado', title: 'Moderado' },
        { id: 'pain_fuerte', title: 'Fuerte' },
      ]);
      return;
    }

    if (normalized === 'pain_leve' || normalized === 'pain_moderado' || normalized === 'pain_fuerte') {
      await this.whatsapp.sendButtons(from, '¿Desde cuándo tienes el dolor?', [
        { id: 'dur_hoy', title: 'Hoy' },
        { id: 'dur_2_3', title: '2-3 días' },
        { id: 'dur_semana', title: '1 semana +' },
      ]);
      return;
    }

    if (normalized === 'dur_hoy' || normalized === 'dur_2_3' || normalized === 'dur_semana') {
      await this.whatsapp.sendText(
        from,
        'Gracias. Te recomiendo una valoración lo antes posible. ¿Quieres que te agendemos hoy?',
      );
      return;
    }

    if (normalized === '3') {
      await this.whatsapp.sendText(
        from,
        'Con gusto 💬 ¿Qué tratamiento te interesa? (limpieza, resina, blanqueamiento, ortodoncia, etc.)',
      );
      return;
    }

    if (normalized === '4') {
      await this.whatsapp.sendText(
        from,
        'Estamos en [tu dirección aquí]. Horario: Lun-Sáb 9am-7pm. ¿Quieres ubicación en mapa?',
      );
      return;
    }

    // Si no coincide, mensaje genérico por ahora
    await this.whatsapp.sendText(from, 'Escribe *menu* para ver opciones 😊');
  }
}
