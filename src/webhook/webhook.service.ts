import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { ClinicsService } from '../clinics/clinics.service';
import { RouterService } from '../agent/router.service';

@Injectable()
export class WebhookService {
  constructor(
    private readonly clinics: ClinicsService,
    private readonly router: RouterService,
  ) {}

  verifySignature(req: Request & { rawBody?: Buffer }, signature256?: string) {
    const appSecret = process.env.APP_SECRET ?? process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) return;
    if (!signature256) throw new Error('Missing signature header');
    const [algo, hash] = signature256.split('=');
    if (algo !== 'sha256' || !hash) throw new Error('Invalid signature format');
    const payload = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const expected = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(hash, 'hex');
    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new Error('Invalid signature');
    }
  }

  async handleWebhookEvent(body: any): Promise<void> {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const text =
      msg.text?.body ||
      msg.interactive?.button_reply?.id ||
      msg.interactive?.list_reply?.id ||
      '';

    const phoneNumberId = this.clinics.extractPhoneNumberId(body);
    if (!phoneNumberId) return;
    const clinic = await this.clinics.findByPhoneNumberId(phoneNumberId);
    if (!clinic) {
      console.warn('[WEBHOOK] sin clínica para phone_number_id', phoneNumberId);
      return;
    }

    await this.router.handle(clinic, from, text);
  }
}
