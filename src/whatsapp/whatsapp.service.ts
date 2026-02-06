import { Injectable } from '@nestjs/common';

@Injectable()
export class WhatsappService {
  private readonly accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
  private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  private readonly testMode = process.env.TEST_MODE === 'true';


  async sendText(to: string, body: string) {
    if (this.testMode) {
      console.log('[TEST_MODE] sendText suppressed', { to, body });
      return { ok: true, testMode: true };
    }

    const url = `https://graph.facebook.com/v22.0/${this.phoneNumberId}/messages`;

    console.log('ENV phoneNumberId:', this.phoneNumberId ? 'OK' : 'MISSING');
    console.log('ENV accessToken:', this.accessToken ? 'OK' : 'MISSING');


    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('WHATSAPP SEND ERROR:', res.status, errText);
      throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
    }

    return res.json();
  }

  async sendButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ) {
    if (this.testMode) {
      console.log('[TEST_MODE] sendButtons suppressed', { to, body, buttons });
      return { ok: true, testMode: true };
    }

    const url = `https://graph.facebook.com/v22.0/${this.phoneNumberId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('WHATSAPP SEND ERROR:', res.status, errText);
      throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
    }

    return res.json();
  }
}
