// src/whatsapp/whatsapp.service.ts
import { Injectable } from '@nestjs/common';

export interface WaCredentials {
  phoneNumberId: string;
  accessToken: string;
}

@Injectable()
export class WhatsappService {
  private get testMode() {
    return process.env.TEST_MODE === 'true';
  }

  private async post(creds: WaCredentials, body: any) {
    if (this.testMode) {
      console.log('[TEST_MODE] WhatsApp suppressed', {
        to: body.to,
        type: body.type,
      });
      return { ok: true, testMode: true };
    }
    const url = `https://graph.facebook.com/v22.0/${creds.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('WHATSAPP SEND ERROR:', res.status, errText);
      throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
    }
    return res.json();
  }

  sendText(creds: WaCredentials, to: string, body: string) {
    return this.post(creds, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  }

  sendButtons(
    creds: WaCredentials,
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ) {
    return this.post(creds, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
  }

  sendList(
    creds: WaCredentials,
    to: string,
    body: string,
    buttonText: string,
    rows: Array<{ id: string; title: string; description?: string }>,
  ) {
    return this.post(creds, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: { button: buttonText, sections: [{ rows }] },
      },
    });
  }
}
