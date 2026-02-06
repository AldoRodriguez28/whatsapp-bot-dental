import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as express from 'express';

async function bootstrap() {
  dotenv.config();

  const app = await NestFactory.create(AppModule);

  // Guardar raw body para validación de firma
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf; // Buffer
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
