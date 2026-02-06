import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Headers,
  HttpStatus,
 } from '@nestjs/common';

import type { Request, Response } from 'express';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  // Meta Verification
  @Get()
  verify(@Req() req: Request, @Res() res: Response) {
    console.log('[WEBHOOK VERIFY]', req.query);
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      return res.status(HttpStatus.OK).send(challenge);
    }
    return res.sendStatus(HttpStatus.FORBIDDEN);
  }

  // Incoming events/messages
  @Post()
  async receive(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-hub-signature-256') signature256?: string,
  ) {
    try {
      console.log('[WEBHOOK EVENT]', { hasBody: !!req.body });
      // 1) Validar firma (si hay APP_SECRET configurado)
      this.webhookService.verifySignature(req, signature256);

      // 2) Procesar payload
      await this.webhookService.handleWebhookEvent(req.body);

      // Meta recomienda 200 siempre para evitar reintentos agresivos
      return res.sendStatus(HttpStatus.OK);
    } catch (err) {
      // Importante: no fallar duro; devuelve 200 para no reintentar infinito
      console.error('Webhook error:', err);
      return res.sendStatus(HttpStatus.OK);
    }
  }
}
