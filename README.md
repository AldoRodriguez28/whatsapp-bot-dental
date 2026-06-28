<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

WhatsApp chatbot for dental clinics — multi-tenant, NestJS + Prisma + Postgres, Google Calendar mirror, Claude (Anthropic) hybrid agent, same-day appointment reminders.

---

## Setup Fase 1

### 1. Requisitos previos

- Node.js >= 20.19 o >= 22.12 (recomendado). Prisma v6 requiere estas versiones mínimas.
  - En Render, usa **Node 20** o **Node 22** en la configuración del servicio para evitar warnings del motor de Prisma con Node 23.
- yarn (local) o npm (Render usa `npm ci` según `render.yaml`).

### 2. Variables de entorno

Copia `.env.example` a `.env` y rellena todos los valores:

```bash
cp .env.example .env
```

Las variables principales:

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP (default 3000) |
| `DATABASE_URL` | Postgres connection string |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificación del webhook Meta |
| `APP_SECRET` / `WHATSAPP_APP_SECRET` | Secreto HMAC para validar X-Hub-Signature-256 |
| `TEST_MODE` | `true` omite llamadas reales a WhatsApp API |
| `ANTHROPIC_API_KEY` | Clave de API Anthropic (Claude) |
| `ANTHROPIC_MODEL` | Modelo a usar (default `claude-opus-4-8`) |
| `GOOGLE_SERVICE_ACCOUNT` | JSON completo de la cuenta de servicio Google |
| `REMINDERS_TOKEN` | Bearer token secreto para `POST /reminders/run` |

### 3. Base de datos (Neon / Supabase / local)

1. Crea un proyecto Postgres en [Neon](https://neon.tech) o [Supabase](https://supabase.com) (o usa Docker localmente).
2. Copia la connection string a `DATABASE_URL` en tu `.env`.
3. Aplica las migraciones:
   ```bash
   npx prisma migrate deploy
   ```
4. Siembra la primera clínica de prueba:
   ```bash
   # Opcional: sobreescribe los defaults del seed con vars de entorno
   SEED_WA_PHONE_NUMBER_ID=tu_phone_number_id \
   SEED_WA_ACCESS_TOKEN=tu_access_token \
   SEED_GOOGLE_CALENDAR_ID=id_del_calendario \
   npx prisma db seed
   ```

### 4. Google Calendar (cuenta de servicio)

1. En [Google Cloud Console](https://console.cloud.google.com), crea un proyecto y habilita la **Google Calendar API**.
2. Crea una **cuenta de servicio** y descarga su clave JSON.
3. Comparte el calendario de la clínica con el `client_email` de la cuenta de servicio (rol "Hacer cambios en eventos").
4. Pega el contenido del JSON (en una sola línea o codificado en base64) como valor de `GOOGLE_SERVICE_ACCOUNT` en tu `.env`.
5. Anota el `calendarId` (p.ej. `clinica@example.com` o un ID largo) — es el `SEED_GOOGLE_CALENDAR_ID` o el campo `googleCalendarId` en la tabla `clinics`.

### 5. Cron externo para recordatorios

El endpoint `POST /reminders/run` envía recordatorios del mismo día y debe llamarse desde un cron externo (Render Free duerme entre requests).

**Opción A: cron-job.org**

1. Ve a [cron-job.org](https://cron-job.org) y crea una cuenta gratuita.
2. Crea un nuevo cron job:
   - **URL:** `https://<tu-app>.onrender.com/reminders/run`
   - **Method:** `POST`
   - **Header:** `Authorization: Bearer <REMINDERS_TOKEN>`
   - **Schedule:** cada mañana a la hora deseada (p.ej. `0 9 * * *` para las 9:00 AM)

**Opción B: GitHub Actions**

```yaml
# .github/workflows/reminders.yml
on:
  schedule:
    - cron: '0 9 * * *'   # 9:00 AM UTC cada día
jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s -X POST https://<tu-app>.onrender.com/reminders/run \
            -H "Authorization: Bearer ${{ secrets.REMINDERS_TOKEN }}"
```

### 6. Deploy en Render

1. Conecta el repositorio en [Render](https://render.com) y usa el `render.yaml` existente.
2. En el dashboard de Render, configura todas las variables de entorno marcadas `sync: false` (ver `render.yaml`).
3. En **Pre-Deploy Command** (o ejecuta manualmente tras el primer deploy):
   ```bash
   npx prisma migrate deploy
   ```
4. Render ejecutará `npm ci && npx prisma generate && npm run build` y luego `npm run start:prod`.

> **Nota Node.js en Render:** Prisma v6 emite un warning con Node 23. Configura el servicio con Node 20 o 22 en el campo "Node version" del panel de Render para un build limpio.

---

## Project setup

```bash
$ yarn install
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ yarn install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
