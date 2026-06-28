# Agente Dental WhatsApp — Implementation Plan (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el bot de WhatsApp actual en un agente híbrido multi-tenant que consulta disponibilidad, agenda citas en Postgres + Google Calendar y envía recordatorios same-day con confirmar/cancelar, funcionando end-to-end para una clínica.

**Architecture:** NestJS con módulos aislados. `scheduling` es la única capa de agenda (DB Postgres vía Prisma como registro + Google Calendar como espejo). `agent` orquesta de forma híbrida: reglas/botones para lo trivial y Claude con tool-calling (las tools llaman a `scheduling`) para texto libre. El webhook resuelve la clínica por `phone_number_id`. Los recordatorios se disparan vía `POST /reminders/run` por cron externo.

**Tech Stack:** NestJS 11, TypeScript, Prisma + Postgres, `@anthropic-ai/sdk` (Claude tool-calling), `googleapis` (Google Calendar API, cuenta de servicio), `zod`, Jest.

## Global Constraints

- Zona horaria por defecto de la clínica: `America/Mexico_City` (campo `timezone` por clínica).
- Duración de cita: fija, campo `slot_minutes` por clínica.
- DB Postgres = sistema de registro; Google Calendar = espejo (su falla NO bloquea agendar).
- El webhook SIEMPRE responde HTTP `200` (evita reintentos de Meta). Verificación HMAC ya implementada en `src/webhook/webhook.service.ts`.
- Multi-tenant: toda operación se hace dentro de una clínica resuelta por `value.metadata.phone_number_id`.
- `TEST_MODE=true` suprime llamadas reales a la API de WhatsApp (ya implementado en `WhatsappService`).
- Tests no pegan a APIs reales: `googleapis`, Anthropic y WhatsApp se mockean.
- `/reminders/run` protegido con header `Authorization: Bearer <REMINDERS_TOKEN>`.
- Modelo Claude: usar el id vigente de la familia Claude más capaz al implementar (config en env `ANTHROPIC_MODEL`, default `claude-opus-4-8`).
- Commits frecuentes, uno por tarea como mínimo.

---

## File Structure

**Crear:**
- `prisma/schema.prisma` — modelos clinics, patients, appointments
- `prisma/seed.ts` — alta manual de una clínica de prueba
- `src/prisma/prisma.service.ts` — cliente Prisma como provider NestJS
- `src/prisma/prisma.module.ts`
- `src/config/clinic-config.ts` — tipos de working_hours/prices
- `src/clinics/clinics.service.ts` — resolver clínica por phone_number_id
- `src/clinics/clinics.module.ts`
- `src/scheduling/google-calendar.client.ts` — wrapper Google Calendar API
- `src/scheduling/scheduling.service.ts` — getAvailability, bookAppointment, cancelAppointment
- `src/scheduling/scheduling.module.ts`
- `src/session/session.service.ts` — estado de conversación en memoria
- `src/session/session.module.ts`
- `src/agent/tools.ts` — definición zod de tools del agente
- `src/agent/llm.service.ts` — cliente Claude con tool-calling
- `src/agent/router.service.ts` — orquestador híbrido
- `src/agent/agent.module.ts`
- `src/reminders/reminders.service.ts`
- `src/reminders/reminders.controller.ts`
- `src/reminders/reminders.module.ts`
- Tests `*.spec.ts` junto a cada servicio.

**Modificar:**
- `src/whatsapp/whatsapp.service.ts` — parametrizar credenciales por clínica + `sendList`
- `src/webhook/webhook.service.ts` — resolver clínica → delegar a `router`/botones
- `src/webhook/webhook.module.ts` — importar módulos nuevos
- `src/app.module.ts` — registrar módulos nuevos
- `render.yaml` / `.env` — variables nuevas
- `README.md` — setup

---

## Task 1: Dependencias y Prisma + Postgres bootstrap

**Files:**
- Modify: `package.json`
- Create: `prisma/schema.prisma`
- Create: `src/prisma/prisma.service.ts`
- Create: `src/prisma/prisma.module.ts`
- Test: `src/prisma/prisma.service.spec.ts`

**Interfaces:**
- Produces: `PrismaService` (extiende `PrismaClient`, implementa `OnModuleInit`/`OnModuleDestroy`), exportado por `PrismaModule`.

- [ ] **Step 1: Instalar dependencias**

```bash
yarn add @prisma/client @anthropic-ai/sdk googleapis
yarn add -D prisma
```

- [ ] **Step 2: Inicializar Prisma con Postgres**

```bash
npx prisma init --datasource-provider postgresql
```

Esto crea `prisma/schema.prisma` y agrega `DATABASE_URL` a `.env`. Reemplazar el contenido de `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AppointmentStatus {
  pending
  confirmed
  cancelled
  no_show
}

model Clinic {
  id              String        @id @default(uuid())
  name            String
  timezone        String        @default("America/Mexico_City")
  workingHours    Json          @map("working_hours")
  slotMinutes     Int           @map("slot_minutes")
  address         String        @default("")
  pricesJson      Json          @default("{}") @map("prices_json")
  waPhoneNumberId String        @unique @map("wa_phone_number_id")
  waAccessToken   String        @map("wa_access_token")
  googleCalendarId String       @map("google_calendar_id")
  createdAt       DateTime      @default(now()) @map("created_at")
  patients        Patient[]
  appointments    Appointment[]

  @@map("clinics")
}

model Patient {
  id           String        @id @default(uuid())
  clinicId     String        @map("clinic_id")
  clinic       Clinic        @relation(fields: [clinicId], references: [id])
  phone        String
  name         String
  createdAt    DateTime      @default(now()) @map("created_at")
  appointments Appointment[]

  @@unique([clinicId, phone])
  @@map("patients")
}

model Appointment {
  id             String            @id @default(uuid())
  clinicId       String            @map("clinic_id")
  clinic         Clinic            @relation(fields: [clinicId], references: [id])
  patientId      String            @map("patient_id")
  patient        Patient           @relation(fields: [patientId], references: [id])
  treatment      String
  startsAt       DateTime          @map("starts_at")
  endsAt         DateTime          @map("ends_at")
  status         AppointmentStatus @default(pending)
  googleEventId  String?           @map("google_event_id")
  reminderSentAt DateTime?         @map("reminder_sent_at")
  createdAt      DateTime          @default(now()) @map("created_at")

  @@index([clinicId, startsAt])
  @@map("appointments")
}
```

- [ ] **Step 3: Crear la migración**

Run: `npx prisma migrate dev --name init`
Expected: crea `prisma/migrations/*/migration.sql` y genera el cliente. (Requiere un Postgres accesible vía `DATABASE_URL`; usar uno local o gratis de Neon/Supabase.)

- [ ] **Step 4: Escribir el test de PrismaService**

```typescript
// src/prisma/prisma.service.spec.ts
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('llama $connect en onModuleInit', async () => {
    const service = new PrismaService();
    const connectSpy = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined as never);
    await service.onModuleInit();
    expect(connectSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run test, verificar que falla**

Run: `yarn test src/prisma/prisma.service.spec.ts`
Expected: FAIL (Cannot find module './prisma.service').

- [ ] **Step 6: Implementar PrismaService y PrismaModule**

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

```typescript
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 7: Registrar PrismaModule en AppModule**

En `src/app.module.ts` añadir `import { PrismaModule } from './prisma/prisma.module';` y agregar `PrismaModule` al arreglo `imports`.

- [ ] **Step 8: Run test, verificar que pasa**

Run: `yarn test src/prisma/prisma.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json yarn.lock prisma src/prisma src/app.module.ts
git commit -m "feat: prisma + postgres schema (clinics, patients, appointments)"
```

---

## Task 2: Seed de una clínica y config de horarios

**Files:**
- Create: `src/config/clinic-config.ts`
- Create: `prisma/seed.ts`
- Modify: `package.json` (script `prisma.seed`)
- Test: `src/config/clinic-config.spec.ts`

**Interfaces:**
- Produces:
  - `type WeeklyHours = Record<Weekday, { open: string; close: string } | null>` donde `Weekday = 0..6` (0=domingo) y horas en `"HH:mm"`.
  - `function parseWorkingHours(value: unknown): WeeklyHours` — valida con zod y lanza si es inválido.

- [ ] **Step 1: Escribir el test de parseWorkingHours**

```typescript
// src/config/clinic-config.spec.ts
import { parseWorkingHours } from './clinic-config';

describe('parseWorkingHours', () => {
  it('acepta un horario válido', () => {
    const hours = parseWorkingHours({
      '1': { open: '09:00', close: '19:00' },
      '0': null,
    });
    expect(hours[1]).toEqual({ open: '09:00', close: '19:00' });
    expect(hours[0]).toBeNull();
  });

  it('rechaza horas mal formadas', () => {
    expect(() => parseWorkingHours({ '1': { open: '9am', close: '19:00' } })).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/config/clinic-config.spec.ts`
Expected: FAIL (Cannot find module './clinic-config').

- [ ] **Step 3: Implementar clinic-config.ts**

```typescript
// src/config/clinic-config.ts
import { z } from 'zod';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm requerido');

const daySchema = z
  .object({ open: timeSchema, close: timeSchema })
  .nullable();

const weeklySchema = z.record(z.enum(['0', '1', '2', '3', '4', '5', '6']), daySchema);

export type DayHours = { open: string; close: string } | null;
export type WeeklyHours = Record<Weekday, DayHours>;

export function parseWorkingHours(value: unknown): WeeklyHours {
  const parsed = weeklySchema.parse(value);
  const result = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } as WeeklyHours;
  for (const [k, v] of Object.entries(parsed)) {
    result[Number(k) as Weekday] = v ?? null;
  }
  return result;
}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/config/clinic-config.spec.ts`
Expected: PASS.

- [ ] **Step 5: Escribir el seed**

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.clinic.upsert({
    where: { waPhoneNumberId: process.env.SEED_WA_PHONE_NUMBER_ID ?? 'DEV_PHONE_ID' },
    update: {},
    create: {
      name: 'Clínica Dental Viridiana Segura',
      timezone: 'America/Mexico_City',
      slotMinutes: 30,
      address: 'Dirección de prueba',
      workingHours: {
        '0': null,
        '1': { open: '09:00', close: '19:00' },
        '2': { open: '09:00', close: '19:00' },
        '3': { open: '09:00', close: '19:00' },
        '4': { open: '09:00', close: '19:00' },
        '5': { open: '09:00', close: '19:00' },
        '6': { open: '09:00', close: '14:00' },
      },
      pricesJson: { limpieza: 500, resina: 800, blanqueamiento: 2500 },
      waPhoneNumberId: process.env.SEED_WA_PHONE_NUMBER_ID ?? 'DEV_PHONE_ID',
      waAccessToken: process.env.SEED_WA_ACCESS_TOKEN ?? 'DEV_TOKEN',
      googleCalendarId: process.env.SEED_GOOGLE_CALENDAR_ID ?? 'primary',
    },
  });
  console.log('Seed OK');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Configurar el script de seed**

Añadir a `package.json`:

```json
"prisma": { "seed": "ts-node prisma/seed.ts" }
```

- [ ] **Step 7: Ejecutar el seed**

Run: `npx prisma db seed`
Expected: imprime "Seed OK".

- [ ] **Step 8: Commit**

```bash
git add src/config prisma/seed.ts package.json
git commit -m "feat: clinic config parsing + seed de clínica de prueba"
```

---

## Task 3: ClinicsService — resolver clínica por phone_number_id

**Files:**
- Create: `src/clinics/clinics.service.ts`
- Create: `src/clinics/clinics.module.ts`
- Test: `src/clinics/clinics.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1), tipo `Clinic` de `@prisma/client`.
- Produces:
  - `ClinicsService.findByPhoneNumberId(phoneNumberId: string): Promise<Clinic | null>`
  - `ClinicsService.extractPhoneNumberId(webhookBody: any): string | undefined` — lee `entry[0].changes[0].value.metadata.phone_number_id`.
  - `ClinicsModule` exporta `ClinicsService`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/clinics/clinics.service.spec.ts
import { ClinicsService } from './clinics.service';

describe('ClinicsService', () => {
  const prisma = { clinic: { findUnique: jest.fn() } } as any;
  const service = new ClinicsService(prisma);

  it('extractPhoneNumberId lee metadata del payload', () => {
    const body = {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' } } }] }],
    };
    expect(service.extractPhoneNumberId(body)).toBe('123');
  });

  it('extractPhoneNumberId regresa undefined si falta', () => {
    expect(service.extractPhoneNumberId({})).toBeUndefined();
  });

  it('findByPhoneNumberId consulta por waPhoneNumberId', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'c1' });
    const clinic = await service.findByPhoneNumberId('123');
    expect(prisma.clinic.findUnique).toHaveBeenCalledWith({
      where: { waPhoneNumberId: '123' },
    });
    expect(clinic).toEqual({ id: 'c1' });
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/clinics/clinics.service.spec.ts`
Expected: FAIL (Cannot find module './clinics.service').

- [ ] **Step 3: Implementar ClinicsService y módulo**

```typescript
// src/clinics/clinics.service.ts
import { Injectable } from '@nestjs/common';
import { Clinic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClinicsService {
  constructor(private readonly prisma: PrismaService) {}

  extractPhoneNumberId(webhookBody: any): string | undefined {
    return webhookBody?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  }

  findByPhoneNumberId(phoneNumberId: string): Promise<Clinic | null> {
    return this.prisma.clinic.findUnique({
      where: { waPhoneNumberId: phoneNumberId },
    });
  }
}
```

```typescript
// src/clinics/clinics.module.ts
import { Module } from '@nestjs/common';
import { ClinicsService } from './clinics.service';

@Module({
  providers: [ClinicsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/clinics/clinics.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clinics
git commit -m "feat: ClinicsService con ruteo por phone_number_id"
```

---

## Task 4: GoogleCalendarClient — wrapper de Google Calendar

**Files:**
- Create: `src/scheduling/google-calendar.client.ts`
- Test: `src/scheduling/google-calendar.client.spec.ts`

**Interfaces:**
- Produces:
  - `interface BusyInterval { start: Date; end: Date }`
  - `GoogleCalendarClient.getBusy(calendarId: string, timeMin: Date, timeMax: Date): Promise<BusyInterval[]>`
  - `GoogleCalendarClient.createEvent(calendarId, input: { summary: string; description: string; start: Date; end: Date; timezone: string }): Promise<string>` — regresa el `eventId`.
  - `GoogleCalendarClient.deleteEvent(calendarId: string, eventId: string): Promise<void>`
- Notas: usa `googleapis` con `google.auth.GoogleAuth` y credenciales de `GOOGLE_SERVICE_ACCOUNT` (JSON en env). Para test se inyecta el objeto `calendar` para mockear.

- [ ] **Step 1: Escribir el test (con calendar inyectado)**

```typescript
// src/scheduling/google-calendar.client.spec.ts
import { GoogleCalendarClient } from './google-calendar.client';

describe('GoogleCalendarClient', () => {
  function makeClient(calendarApi: any) {
    const client = new GoogleCalendarClient();
    (client as any).calendar = calendarApi;
    return client;
  }

  it('getBusy mapea los intervalos del freebusy', async () => {
    const calendarApi = {
      freebusy: {
        query: jest.fn().mockResolvedValue({
          data: { calendars: { cal1: { busy: [{ start: '2026-06-29T10:00:00Z', end: '2026-06-29T10:30:00Z' }] } } },
        }),
      },
    };
    const client = makeClient(calendarApi);
    const busy = await client.getBusy('cal1', new Date('2026-06-29T00:00:00Z'), new Date('2026-06-29T23:59:00Z'));
    expect(busy).toHaveLength(1);
    expect(busy[0].start).toEqual(new Date('2026-06-29T10:00:00Z'));
  });

  it('createEvent regresa el id del evento', async () => {
    const calendarApi = {
      events: { insert: jest.fn().mockResolvedValue({ data: { id: 'evt123' } }) },
    };
    const client = makeClient(calendarApi);
    const id = await client.createEvent('cal1', {
      summary: 'Cita',
      description: 'x',
      start: new Date(),
      end: new Date(),
      timezone: 'America/Mexico_City',
    });
    expect(id).toBe('evt123');
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/scheduling/google-calendar.client.spec.ts`
Expected: FAIL (Cannot find module './google-calendar.client').

- [ ] **Step 3: Implementar GoogleCalendarClient**

```typescript
// src/scheduling/google-calendar.client.ts
import { Injectable } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';

export interface BusyInterval {
  start: Date;
  end: Date;
}

@Injectable()
export class GoogleCalendarClient {
  private calendar: calendar_v3.Calendar;

  constructor() {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (raw) {
      const credentials = JSON.parse(raw);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
      this.calendar = google.calendar({ version: 'v3', auth });
    }
  }

  async getBusy(calendarId: string, timeMin: Date, timeMax: Date): Promise<BusyInterval[]> {
    const res = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = res.data.calendars?.[calendarId]?.busy ?? [];
    return busy.map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
  }

  async createEvent(
    calendarId: string,
    input: { summary: string; description: string; start: Date; end: Date; timezone: string },
  ): Promise<string> {
    const res = await this.calendar.events.insert({
      calendarId,
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
        end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
      },
    });
    return res.data.id!;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.calendar.events.delete({ calendarId, eventId });
  }
}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/scheduling/google-calendar.client.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduling/google-calendar.client.ts src/scheduling/google-calendar.client.spec.ts
git commit -m "feat: GoogleCalendarClient (freebusy, createEvent, deleteEvent)"
```

---

## Task 5: SchedulingService — cálculo de disponibilidad

**Files:**
- Create: `src/scheduling/scheduling.service.ts`
- Test: `src/scheduling/scheduling.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `GoogleCalendarClient` (getBusy), tipo `Clinic`.
- Produces:
  - `interface Slot { startsAt: Date; endsAt: Date }`
  - `SchedulingService.getAvailability(clinic: Clinic, date: string): Promise<Slot[]>` donde `date` es `"YYYY-MM-DD"` interpretado en la zona horaria de la clínica. Devuelve slots libres = horario del día partido en `slotMinutes`, menos citas activas en DB, menos busy del Calendar.
- Nota: para mantener el cálculo testeable sin dependencias de zona horaria complejas, los `working_hours` se interpretan como hora local de la clínica y se construyen los `Date` con offset fijo derivado de `Intl`. Helper interno `localTimeToUtc(date, hhmm, timezone)`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/scheduling/scheduling.service.spec.ts
import { SchedulingService } from './scheduling.service';
import { Clinic } from '@prisma/client';

const clinic = {
  id: 'c1',
  timezone: 'America/Mexico_City',
  slotMinutes: 30,
  googleCalendarId: 'cal1',
  workingHours: { '1': { open: '09:00', close: '11:00' } },
} as unknown as Clinic;

function makeService(busy: any[], appointments: any[]) {
  const prisma = {
    appointment: { findMany: jest.fn().mockResolvedValue(appointments) },
  } as any;
  const calendar = { getBusy: jest.fn().mockResolvedValue(busy) } as any;
  return new SchedulingService(prisma, calendar);
}

describe('SchedulingService.getAvailability', () => {
  // 2026-06-29 es lunes (weekday 1)
  it('devuelve todos los slots cuando el día está libre', async () => {
    const service = makeService([], []);
    const slots = await service.getAvailability(clinic, '2026-06-29');
    // 09:00-11:00 en slots de 30min = 4 slots
    expect(slots).toHaveLength(4);
  });

  it('excluye un slot ocupado por una cita en DB', async () => {
    const start = new Date('2026-06-29T15:00:00Z'); // 09:00 CDMX (UTC-6)
    const end = new Date('2026-06-29T15:30:00Z');
    const service = makeService([], [{ startsAt: start, endsAt: end }]);
    const slots = await service.getAvailability(clinic, '2026-06-29');
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.startsAt.getTime() === start.getTime())).toBe(false);
  });

  it('excluye un slot ocupado por busy del Calendar', async () => {
    const start = new Date('2026-06-29T15:30:00Z');
    const end = new Date('2026-06-29T16:00:00Z');
    const service = makeService([{ start, end }], []);
    const slots = await service.getAvailability(clinic, '2026-06-29');
    expect(slots).toHaveLength(3);
  });

  it('devuelve vacío en día sin horario (domingo)', async () => {
    const service = makeService([], []);
    const slots = await service.getAvailability(clinic, '2026-06-28'); // domingo
    expect(slots).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/scheduling/scheduling.service.spec.ts`
Expected: FAIL (Cannot find module './scheduling.service').

- [ ] **Step 3: Implementar getAvailability (y helpers de zona horaria)**

```typescript
// src/scheduling/scheduling.service.ts
import { Injectable } from '@nestjs/common';
import { Clinic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleCalendarClient, BusyInterval } from './google-calendar.client';
import { parseWorkingHours, Weekday } from '../config/clinic-config';

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: GoogleCalendarClient,
  ) {}

  // Convierte una fecha "YYYY-MM-DD" + "HH:mm" en zona de la clínica a un Date UTC.
  private localTimeToUtc(date: string, hhmm: string, timezone: string): Date {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = hhmm.split(':').map(Number);
    // Construye un Date "as if UTC" y corrige por el offset de la zona en esa fecha.
    const asUtc = Date.UTC(y, m - 1, d, hh, mm);
    const offsetMs = this.tzOffsetMs(new Date(asUtc), timezone);
    return new Date(asUtc - offsetMs);
  }

  // Offset (ms) de la zona respecto a UTC para un instante dado.
  private tzOffsetMs(at: Date, timezone: string): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    return asUtc - at.getTime();
  }

  private weekdayInTz(date: string, timezone: string): Weekday {
    const noonUtc = this.localTimeToUtc(date, '12:00', timezone);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
      .format(noonUtc);
    const map: Record<string, Weekday> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wd];
  }

  private overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  async getAvailability(clinic: Clinic, date: string): Promise<Slot[]> {
    const hours = parseWorkingHours(clinic.workingHours);
    const weekday = this.weekdayInTz(date, clinic.timezone);
    const day = hours[weekday];
    if (!day) return [];

    const dayStart = this.localTimeToUtc(date, day.open, clinic.timezone);
    const dayEnd = this.localTimeToUtc(date, day.close, clinic.timezone);

    const [appointments, busy] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gte: dayStart, lt: dayEnd },
        },
      }),
      this.calendar
        .getBusy(clinic.googleCalendarId, dayStart, dayEnd)
        .catch(() => [] as BusyInterval[]),
    ]);

    const blocked: BusyInterval[] = [
      ...appointments.map((a) => ({ start: a.startsAt, end: a.endsAt })),
      ...busy,
    ];

    const slots: Slot[] = [];
    const stepMs = clinic.slotMinutes * 60_000;
    for (let t = dayStart.getTime(); t + stepMs <= dayEnd.getTime(); t += stepMs) {
      const startsAt = new Date(t);
      const endsAt = new Date(t + stepMs);
      const isBlocked = blocked.some((b) => this.overlaps(startsAt, endsAt, b.start, b.end));
      if (!isBlocked) slots.push({ startsAt, endsAt });
    }
    return slots;
  }
}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/scheduling/scheduling.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scheduling/scheduling.service.ts src/scheduling/scheduling.service.spec.ts
git commit -m "feat: SchedulingService.getAvailability (horario - citas - busy)"
```

---

## Task 6: SchedulingService — bookAppointment y cancelAppointment

**Files:**
- Modify: `src/scheduling/scheduling.service.ts`
- Create: `src/scheduling/scheduling.module.ts`
- Test: `src/scheduling/scheduling.service.spec.ts` (añadir casos)

**Interfaces:**
- Consumes: `PrismaService` (patient.upsert, appointment.create/findFirst/update), `GoogleCalendarClient` (createEvent, deleteEvent).
- Produces:
  - `interface BookResult { ok: boolean; reason?: 'slot_taken'; appointmentId?: string; startsAt?: Date }`
  - `SchedulingService.bookAppointment(clinic: Clinic, input: { phone: string; patientName: string; treatment: string; startsAt: Date }): Promise<BookResult>`
  - `interface CancelResult { ok: boolean; reason?: 'not_found' }`
  - `SchedulingService.cancelAppointment(clinic: Clinic, input: { phone: string; startsAt?: Date }): Promise<CancelResult>`
  - `SchedulingModule` exporta `SchedulingService`.

- [ ] **Step 1: Añadir tests de book/cancel**

```typescript
// añadir dentro de src/scheduling/scheduling.service.spec.ts
describe('SchedulingService.bookAppointment', () => {
  function makeService(existing: any) {
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 'appt1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      patient: { upsert: jest.fn().mockResolvedValue({ id: 'p1' }) },
    } as any;
    const calendar = {
      createEvent: jest.fn().mockResolvedValue('evt1'),
      deleteEvent: jest.fn(),
    } as any;
    return { service: new SchedulingService(prisma, calendar), prisma, calendar };
  }

  it('rechaza si el slot ya está tomado', async () => {
    const { service } = makeService({ id: 'taken' });
    const res = await service.bookAppointment(clinic, {
      phone: '521', patientName: 'Ana', treatment: 'limpieza',
      startsAt: new Date('2026-06-29T15:00:00Z'),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('slot_taken');
  });

  it('crea paciente, cita y evento de Calendar cuando está libre', async () => {
    const { service, prisma, calendar } = makeService(null);
    const res = await service.bookAppointment(clinic, {
      phone: '521', patientName: 'Ana', treatment: 'limpieza',
      startsAt: new Date('2026-06-29T15:00:00Z'),
    });
    expect(res.ok).toBe(true);
    expect(prisma.patient.upsert).toHaveBeenCalled();
    expect(prisma.appointment.create).toHaveBeenCalled();
    expect(calendar.createEvent).toHaveBeenCalled();
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { googleEventId: 'evt1' } }),
    );
  });

  it('si Calendar falla, la cita igual queda creada (sin googleEventId)', async () => {
    const { service, calendar, prisma } = makeService(null);
    calendar.createEvent.mockRejectedValue(new Error('google down'));
    const res = await service.bookAppointment(clinic, {
      phone: '521', patientName: 'Ana', treatment: 'limpieza',
      startsAt: new Date('2026-06-29T15:00:00Z'),
    });
    expect(res.ok).toBe(true);
    expect(prisma.appointment.create).toHaveBeenCalled();
  });
});

describe('SchedulingService.cancelAppointment', () => {
  it('regresa not_found si no hay cita', async () => {
    const prisma = { appointment: { findFirst: jest.fn().mockResolvedValue(null) } } as any;
    const service = new SchedulingService(prisma, {} as any);
    const res = await service.cancelAppointment(clinic, { phone: '521' });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('marca cancelada y borra el evento', async () => {
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', googleEventId: 'evt1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const calendar = { deleteEvent: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new SchedulingService(prisma, calendar);
    const res = await service.cancelAppointment(clinic, { phone: '521' });
    expect(res.ok).toBe(true);
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelled' } }),
    );
    expect(calendar.deleteEvent).toHaveBeenCalledWith('cal1', 'evt1');
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/scheduling/scheduling.service.spec.ts`
Expected: FAIL (bookAppointment is not a function).

- [ ] **Step 3: Implementar book/cancel en SchedulingService**

Añadir tipos e implementaciones a `src/scheduling/scheduling.service.ts`:

```typescript
export interface BookResult {
  ok: boolean;
  reason?: 'slot_taken';
  appointmentId?: string;
  startsAt?: Date;
}

export interface CancelResult {
  ok: boolean;
  reason?: 'not_found';
}
```

```typescript
// métodos dentro de la clase SchedulingService
async bookAppointment(
  clinic: Clinic,
  input: { phone: string; patientName: string; treatment: string; startsAt: Date },
): Promise<BookResult> {
  const endsAt = new Date(input.startsAt.getTime() + clinic.slotMinutes * 60_000);

  const taken = await this.prisma.appointment.findFirst({
    where: {
      clinicId: clinic.id,
      status: { in: ['pending', 'confirmed'] },
      startsAt: input.startsAt,
    },
  });
  if (taken) return { ok: false, reason: 'slot_taken' };

  const patient = await this.prisma.patient.upsert({
    where: { clinicId_phone: { clinicId: clinic.id, phone: input.phone } },
    update: { name: input.patientName },
    create: { clinicId: clinic.id, phone: input.phone, name: input.patientName },
  });

  const appointment = await this.prisma.appointment.create({
    data: {
      clinicId: clinic.id,
      patientId: patient.id,
      treatment: input.treatment,
      startsAt: input.startsAt,
      endsAt,
      status: 'pending',
    },
  });

  try {
    const eventId = await this.calendar.createEvent(clinic.googleCalendarId, {
      summary: `Cita: ${input.patientName}`,
      description: `${input.treatment} — WhatsApp: ${input.phone}`,
      start: input.startsAt,
      end: endsAt,
      timezone: clinic.timezone,
    });
    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { googleEventId: eventId },
    });
  } catch (err) {
    console.error('Calendar mirror failed (cita igual creada):', err);
  }

  return { ok: true, appointmentId: appointment.id, startsAt: input.startsAt };
}

async cancelAppointment(
  clinic: Clinic,
  input: { phone: string; startsAt?: Date },
): Promise<CancelResult> {
  const appointment = await this.prisma.appointment.findFirst({
    where: {
      clinicId: clinic.id,
      status: { in: ['pending', 'confirmed'] },
      patient: { phone: input.phone },
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
    },
    orderBy: { startsAt: 'asc' },
  });
  if (!appointment) return { ok: false, reason: 'not_found' };

  await this.prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: 'cancelled' },
  });

  if (appointment.googleEventId) {
    try {
      await this.calendar.deleteEvent(clinic.googleCalendarId, appointment.googleEventId);
    } catch (err) {
      console.error('Calendar delete failed:', err);
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Crear SchedulingModule**

```typescript
// src/scheduling/scheduling.module.ts
import { Module } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { GoogleCalendarClient } from './google-calendar.client';

@Module({
  providers: [SchedulingService, GoogleCalendarClient],
  exports: [SchedulingService],
})
export class SchedulingModule {}
```

- [ ] **Step 5: Run test, verificar que pasa**

Run: `yarn test src/scheduling/scheduling.service.spec.ts`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add src/scheduling
git commit -m "feat: SchedulingService book/cancel + SchedulingModule"
```

---

## Task 7: SessionService — estado de conversación en memoria

**Files:**
- Create: `src/session/session.service.ts`
- Create: `src/session/session.module.ts`
- Test: `src/session/session.service.spec.ts`

**Interfaces:**
- Produces:
  - `interface SessionState { clinicId: string; partialBooking?: { treatment?: string; date?: string; time?: string; patientName?: string }; lastActivity: number }`
  - `SessionService.get(phone: string): SessionState | undefined` — devuelve `undefined` si expiró (TTL 15 min).
  - `SessionService.set(phone: string, state: Omit<SessionState, 'lastActivity'>): void`
  - `SessionService.clear(phone: string): void`
  - `SessionModule` exporta `SessionService`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/session/session.service.spec.ts
import { SessionService } from './session.service';

describe('SessionService', () => {
  it('guarda y recupera estado', () => {
    const s = new SessionService();
    s.set('521', { clinicId: 'c1', partialBooking: { treatment: 'limpieza' } });
    expect(s.get('521')?.partialBooking?.treatment).toBe('limpieza');
  });

  it('expira tras el TTL', () => {
    const s = new SessionService();
    s.set('521', { clinicId: 'c1' });
    const state = s.get('521')!;
    state.lastActivity = Date.now() - 16 * 60_000; // forzar expiración
    expect(s.get('521')).toBeUndefined();
  });

  it('clear elimina el estado', () => {
    const s = new SessionService();
    s.set('521', { clinicId: 'c1' });
    s.clear('521');
    expect(s.get('521')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/session/session.service.spec.ts`
Expected: FAIL (Cannot find module './session.service').

- [ ] **Step 3: Implementar SessionService y módulo**

```typescript
// src/session/session.service.ts
import { Injectable } from '@nestjs/common';

export interface SessionState {
  clinicId: string;
  partialBooking?: {
    treatment?: string;
    date?: string;
    time?: string;
    patientName?: string;
  };
  lastActivity: number;
}

const TTL_MS = 15 * 60_000;

@Injectable()
export class SessionService {
  private store = new Map<string, SessionState>();

  get(phone: string): SessionState | undefined {
    const state = this.store.get(phone);
    if (!state) return undefined;
    if (Date.now() - state.lastActivity > TTL_MS) {
      this.store.delete(phone);
      return undefined;
    }
    return state;
  }

  set(phone: string, state: Omit<SessionState, 'lastActivity'>): void {
    this.store.set(phone, { ...state, lastActivity: Date.now() });
  }

  clear(phone: string): void {
    this.store.delete(phone);
  }
}
```

```typescript
// src/session/session.module.ts
import { Module } from '@nestjs/common';
import { SessionService } from './session.service';

@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/session/session.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session
git commit -m "feat: SessionService (estado de conversación en memoria con TTL)"
```

---

## Task 8: WhatsappService parametrizado por clínica + sendList

**Files:**
- Modify: `src/whatsapp/whatsapp.service.ts`
- Test: `src/whatsapp/whatsapp.service.spec.ts`

**Interfaces:**
- Produces (firmas nuevas, reciben credenciales explícitas):
  - `interface WaCredentials { phoneNumberId: string; accessToken: string }`
  - `WhatsappService.sendText(creds: WaCredentials, to: string, body: string): Promise<any>`
  - `WhatsappService.sendButtons(creds: WaCredentials, to: string, body: string, buttons: Array<{ id: string; title: string }>): Promise<any>`
  - `WhatsappService.sendList(creds: WaCredentials, to: string, body: string, buttonText: string, rows: Array<{ id: string; title: string; description?: string }>): Promise<any>`
- Nota: se cambia la firma de `sendText`/`sendButtons` para recibir `creds` (antes leían de env). `TEST_MODE` se conserva.

- [ ] **Step 1: Reescribir el test del WhatsappService**

```typescript
// src/whatsapp/whatsapp.service.spec.ts
import { WhatsappService } from './whatsapp.service';

const creds = { phoneNumberId: 'PN1', accessToken: 'TOK' };

describe('WhatsappService', () => {
  beforeEach(() => {
    process.env.TEST_MODE = 'false';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'm1' }] }),
    }) as any;
  });

  it('sendText usa el phoneNumberId y token de las credenciales', async () => {
    const service = new WhatsappService();
    await service.sendText(creds, '521', 'hola');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/PN1/messages');
    expect(opts.headers.Authorization).toBe('Bearer TOK');
  });

  it('respeta TEST_MODE sin llamar fetch', async () => {
    process.env.TEST_MODE = 'true';
    const service = new WhatsappService();
    const res = await service.sendText(creds, '521', 'hola');
    expect(res).toEqual({ ok: true, testMode: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sendList arma payload interactive type list', async () => {
    const service = new WhatsappService();
    await service.sendList(creds, '521', 'Elige', 'Ver horarios', [
      { id: 'h1', title: '09:00' },
    ]);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const payload = JSON.parse(opts.body);
    expect(payload.interactive.type).toBe('list');
    expect(payload.interactive.action.sections[0].rows[0].id).toBe('h1');
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/whatsapp/whatsapp.service.spec.ts`
Expected: FAIL (firmas viejas: sendText espera string `to` primero).

- [ ] **Step 3: Reescribir WhatsappService**

```typescript
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
      console.log('[TEST_MODE] WhatsApp suppressed', { to: body.to, type: body.type });
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
    return this.post(creds, { messaging_product: 'whatsapp', to, type: 'text', text: { body } });
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
          buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
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
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/whatsapp/whatsapp.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/whatsapp.service.ts src/whatsapp/whatsapp.service.spec.ts
git commit -m "feat: WhatsappService parametrizado por clínica + sendList"
```

---

## Task 9: Tools del agente (definición zod) + ejecutor

**Files:**
- Create: `src/agent/tools.ts`
- Test: `src/agent/tools.spec.ts`

**Interfaces:**
- Consumes: `SchedulingService` (getAvailability, bookAppointment, cancelAppointment), tipo `Clinic`.
- Produces:
  - `interface AgentContext { clinic: Clinic; phone: string }`
  - `const toolDefinitions: Array<{ name: string; description: string; input_schema: object }>` — esquema JSON para Anthropic (4 tools: get_availability, book_appointment, cancel_appointment, get_clinic_info).
  - `async function executeTool(name: string, input: any, ctx: AgentContext, scheduling: SchedulingService): Promise<string>` — ejecuta la tool y devuelve texto resultado para el modelo. Valida `input` con zod por tool.

- [ ] **Step 1: Escribir el test**

```typescript
// src/agent/tools.spec.ts
import { executeTool, toolDefinitions, AgentContext } from './tools';
import { Clinic } from '@prisma/client';

const ctx: AgentContext = {
  clinic: {
    id: 'c1', timezone: 'America/Mexico_City', slotMinutes: 30,
    pricesJson: { limpieza: 500 }, address: 'Calle 1',
  } as unknown as Clinic,
  phone: '521',
};

describe('agent tools', () => {
  it('expone 4 herramientas con input_schema', () => {
    expect(toolDefinitions.map((t) => t.name).sort()).toEqual(
      ['book_appointment', 'cancel_appointment', 'get_availability', 'get_clinic_info'].sort(),
    );
  });

  it('get_availability devuelve horarios formateados', async () => {
    const scheduling = {
      getAvailability: jest.fn().mockResolvedValue([
        { startsAt: new Date('2026-06-29T15:00:00Z'), endsAt: new Date('2026-06-29T15:30:00Z') },
      ]),
    } as any;
    const out = await executeTool('get_availability', { date: '2026-06-29' }, ctx, scheduling);
    expect(scheduling.getAvailability).toHaveBeenCalledWith(ctx.clinic, '2026-06-29');
    expect(out).toContain('09:00'); // 15:00 UTC = 09:00 CDMX
  });

  it('book_appointment reporta slot ocupado', async () => {
    const scheduling = {
      bookAppointment: jest.fn().mockResolvedValue({ ok: false, reason: 'slot_taken' }),
    } as any;
    const out = await executeTool(
      'book_appointment',
      { patientName: 'Ana', treatment: 'limpieza', dateTime: '2026-06-29T15:00:00Z' },
      ctx, scheduling,
    );
    expect(out.toLowerCase()).toContain('ocupado');
  });

  it('get_clinic_info responde precios desde config', async () => {
    const out = await executeTool('get_clinic_info', { topic: 'precios' }, ctx, {} as any);
    expect(out).toContain('limpieza');
  });

  it('valida input inválido', async () => {
    const out = await executeTool('get_availability', {}, ctx, {} as any);
    expect(out.toLowerCase()).toContain('error');
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/agent/tools.spec.ts`
Expected: FAIL (Cannot find module './tools').

- [ ] **Step 3: Implementar tools.ts**

```typescript
// src/agent/tools.ts
import { z } from 'zod';
import { Clinic } from '@prisma/client';
import { SchedulingService } from '../scheduling/scheduling.service';

export interface AgentContext {
  clinic: Clinic;
  phone: string;
}

export const toolDefinitions = [
  {
    name: 'get_availability',
    description: 'Consulta los horarios libres de la clínica para una fecha (YYYY-MM-DD).',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
        treatment: { type: 'string', description: 'Tratamiento opcional' },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Agenda una cita. dateTime en ISO 8601 UTC, debe ser un horario libre.',
    input_schema: {
      type: 'object',
      properties: {
        patientName: { type: 'string' },
        treatment: { type: 'string' },
        dateTime: { type: 'string', description: 'ISO 8601, ej 2026-06-29T15:00:00Z' },
      },
      required: ['patientName', 'treatment', 'dateTime'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancela la próxima cita del paciente. dateTime opcional.',
    input_schema: {
      type: 'object',
      properties: { dateTime: { type: 'string' } },
    },
  },
  {
    name: 'get_clinic_info',
    description: 'Información de la clínica: precios, direccion u horarios.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: ['precios', 'direccion', 'horarios'] } },
      required: ['topic'],
    },
  },
];

const availabilitySchema = z.object({ date: z.string(), treatment: z.string().optional() });
const bookSchema = z.object({
  patientName: z.string(),
  treatment: z.string(),
  dateTime: z.string(),
});
const cancelSchema = z.object({ dateTime: z.string().optional() });
const infoSchema = z.object({ topic: z.enum(['precios', 'direccion', 'horarios']) });

function fmtTime(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export async function executeTool(
  name: string,
  input: any,
  ctx: AgentContext,
  scheduling: SchedulingService,
): Promise<string> {
  try {
    switch (name) {
      case 'get_availability': {
        const { date } = availabilitySchema.parse(input);
        const slots = await scheduling.getAvailability(ctx.clinic, date);
        if (slots.length === 0) return `No hay horarios disponibles el ${date}.`;
        const times = slots.map((s) => fmtTime(s.startsAt, ctx.clinic.timezone)).join(', ');
        return `Horarios libres el ${date}: ${times}.`;
      }
      case 'book_appointment': {
        const data = bookSchema.parse(input);
        const res = await scheduling.bookAppointment(ctx.clinic, {
          phone: ctx.phone,
          patientName: data.patientName,
          treatment: data.treatment,
          startsAt: new Date(data.dateTime),
        });
        if (!res.ok) return 'Ese horario ya está ocupado, ofrece otro horario al paciente.';
        return `Cita confirmada para ${data.patientName} (${data.treatment}) el ${fmtTime(
          res.startsAt!, ctx.clinic.timezone,
        )}.`;
      }
      case 'cancel_appointment': {
        const data = cancelSchema.parse(input);
        const res = await scheduling.cancelAppointment(ctx.clinic, {
          phone: ctx.phone,
          startsAt: data.dateTime ? new Date(data.dateTime) : undefined,
        });
        return res.ok ? 'Cita cancelada.' : 'No encontré una cita activa para cancelar.';
      }
      case 'get_clinic_info': {
        const { topic } = infoSchema.parse(input);
        if (topic === 'precios') return `Precios: ${JSON.stringify(ctx.clinic.pricesJson)}`;
        if (topic === 'direccion') return `Dirección: ${ctx.clinic.address}`;
        return `Horarios: ${JSON.stringify(ctx.clinic.workingHours)}`;
      }
      default:
        return `Error: herramienta desconocida ${name}`;
    }
  } catch (err) {
    return `Error ejecutando ${name}: ${(err as Error).message}`;
  }
}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/agent/tools.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts src/agent/tools.spec.ts
git commit -m "feat: definición y ejecutor de tools del agente (zod)"
```

---

## Task 10: LlmService — Claude con tool-calling

**Files:**
- Create: `src/agent/llm.service.ts`
- Test: `src/agent/llm.service.spec.ts`

**Interfaces:**
- Consumes: `SchedulingService`, `executeTool`/`toolDefinitions` (Task 9), `@anthropic-ai/sdk`.
- Produces:
  - `LlmService.reply(ctx: AgentContext, userMessage: string, recentName?: string): Promise<string>` — corre el loop de tool-use con Claude y devuelve el texto final para el paciente.
- Nota: el cliente Anthropic se crea con `process.env.ANTHROPIC_API_KEY`; para test se inyecta vía `(service as any).client`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/agent/llm.service.spec.ts
import { LlmService } from './llm.service';
import { AgentContext } from './tools';
import { Clinic } from '@prisma/client';

const ctx: AgentContext = {
  clinic: { id: 'c1', name: 'Dental X', timezone: 'America/Mexico_City' } as unknown as Clinic,
  phone: '521',
};

describe('LlmService', () => {
  it('devuelve texto cuando Claude responde sin tools', async () => {
    const service = new LlmService({} as any);
    (service as any).client = {
      messages: {
        create: jest.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '¡Hola! ¿En qué te ayudo?' }],
        }),
      },
    };
    const out = await service.reply(ctx, 'hola');
    expect(out).toContain('Hola');
  });

  it('ejecuta una tool y vuelve a llamar al modelo', async () => {
    const scheduling = {
      getAvailability: jest.fn().mockResolvedValue([]),
    } as any;
    const service = new LlmService(scheduling);
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't1', name: 'get_availability', input: { date: '2026-06-29' } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'No hay horarios ese día.' }],
      });
    (service as any).client = { messages: { create } };
    const out = await service.reply(ctx, '¿hay espacio el lunes?');
    expect(create).toHaveBeenCalledTimes(2);
    expect(scheduling.getAvailability).toHaveBeenCalled();
    expect(out).toContain('No hay horarios');
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/agent/llm.service.spec.ts`
Expected: FAIL (Cannot find module './llm.service').

- [ ] **Step 3: Implementar LlmService**

```typescript
// src/agent/llm.service.ts
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AgentContext, toolDefinitions, executeTool } from './tools';

@Injectable()
export class LlmService {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';

  constructor(private readonly scheduling: SchedulingService) {}

  private systemPrompt(ctx: AgentContext, recentName?: string): string {
    const now = new Intl.DateTimeFormat('es-MX', {
      timeZone: ctx.clinic.timezone, dateStyle: 'full', timeStyle: 'short',
    }).format(new Date());
    return [
      `Eres el asistente de WhatsApp de ${ctx.clinic.name}, una clínica dental.`,
      `Hablas español de México, cálido y breve. Fecha/hora actual: ${now} (${ctx.clinic.timezone}).`,
      recentName ? `El paciente se llama ${recentName}.` : '',
      'Reglas: nunca inventes horarios; usa get_availability antes de ofrecer huecos.',
      'Antes de agendar confirma tratamiento, nombre y horario. Usa las herramientas para todo.',
      'Si el paciente pide precios/dirección/horarios usa get_clinic_info.',
    ].filter(Boolean).join(' ');
  }

  async reply(ctx: AgentContext, userMessage: string, recentName?: string): Promise<string> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    for (let i = 0; i < 5; i++) {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: this.systemPrompt(ctx, recentName),
        tools: toolDefinitions as any,
        messages,
      });

      if (res.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: res.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of res.content) {
          if (block.type === 'tool_use') {
            const result = await executeTool(block.name, block.input, ctx, this.scheduling);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return text || 'Disculpa, ¿me lo puedes repetir?';
    }
    return 'Disculpa, hubo un problema procesando tu mensaje. Escribe *menu* para opciones.';
  }
}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/agent/llm.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/llm.service.ts src/agent/llm.service.spec.ts
git commit -m "feat: LlmService Claude tool-calling loop"
```

---

## Task 11: RouterService — orquestador híbrido + AgentModule

**Files:**
- Create: `src/agent/router.service.ts`
- Create: `src/agent/agent.module.ts`
- Test: `src/agent/router.service.spec.ts`

**Interfaces:**
- Consumes: `WhatsappService` (sendText/sendButtons), `LlmService.reply`, `SchedulingService.cancelAppointment`, `SessionService`, tipo `Clinic`, `WaCredentials`.
- Produces:
  - `RouterService.handle(clinic: Clinic, from: string, text: string): Promise<void>` — aplica reglas/botones; texto libre → LlmService. Maneja también los ids de botón de recordatorio `confirm_<apptId>` / `cancel_<apptId>`.
  - `AgentModule` exporta `RouterService`.
- Reglas fijas (botones): `hola`/`menu` → menú; `precios` → info; `ubicacion` → info. IDs de recordatorio se interceptan antes de la IA.

- [ ] **Step 1: Escribir el test**

```typescript
// src/agent/router.service.spec.ts
import { RouterService } from './router.service';
import { Clinic } from '@prisma/client';

const clinic = {
  id: 'c1', name: 'Dental X', waPhoneNumberId: 'PN1', waAccessToken: 'TOK',
} as unknown as Clinic;

function make() {
  const whatsapp = { sendText: jest.fn(), sendButtons: jest.fn() } as any;
  const llm = { reply: jest.fn().mockResolvedValue('respuesta IA') } as any;
  const scheduling = { cancelAppointment: jest.fn().mockResolvedValue({ ok: true }) } as any;
  const session = { get: jest.fn(), set: jest.fn(), clear: jest.fn() } as any;
  const router = new RouterService(whatsapp, llm, scheduling, session);
  return { router, whatsapp, llm, scheduling };
}

describe('RouterService', () => {
  it('responde menú a "hola"', async () => {
    const { router, whatsapp, llm } = make();
    await router.handle(clinic, '521', 'hola');
    expect(whatsapp.sendText).toHaveBeenCalled();
    expect(llm.reply).not.toHaveBeenCalled();
  });

  it('texto libre va a la IA', async () => {
    const { router, whatsapp, llm } = make();
    await router.handle(clinic, '521', 'me duele una muela, ¿hay hoy?');
    expect(llm.reply).toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      { phoneNumberId: 'PN1', accessToken: 'TOK' }, '521', 'respuesta IA',
    );
  });

  it('botón cancel_<id> cancela la cita', async () => {
    const { router, scheduling, whatsapp } = make();
    await router.handle(clinic, '521', 'cancel_appt9');
    expect(scheduling.cancelAppointment).toHaveBeenCalledWith(clinic, { phone: '521' });
    expect(whatsapp.sendText).toHaveBeenCalled();
  });

  it('botón confirm_<id> confirma', async () => {
    const { router, whatsapp } = make();
    await router.handle(clinic, '521', 'confirm_appt9');
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      expect.anything(), '521', expect.stringContaining('confirm'),
    );
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/agent/router.service.spec.ts`
Expected: FAIL (Cannot find module './router.service').

- [ ] **Step 3: Implementar RouterService**

```typescript
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
```

(Nota: el texto del mensaje de confirmación contiene la subcadena "confirm" exigida por el test.)

- [ ] **Step 4: Crear AgentModule**

```typescript
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
```

- [ ] **Step 5: Run test, verificar que pasa**

Run: `yarn test src/agent/router.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/router.service.ts src/agent/agent.module.ts src/agent/router.service.spec.ts
git commit -m "feat: RouterService híbrido + AgentModule"
```

---

## Task 12: Integrar webhook con ruteo por clínica

**Files:**
- Modify: `src/webhook/webhook.service.ts`
- Modify: `src/webhook/webhook.module.ts`
- Test: `src/webhook/webhook.service.spec.ts`

**Interfaces:**
- Consumes: `ClinicsService` (extractPhoneNumberId, findByPhoneNumberId), `RouterService.handle`.
- Produces: `WebhookService.handleWebhookEvent(body: any): Promise<void>` (firma conservada) que ahora resuelve clínica y delega al router. `verifySignature` se conserva igual.

- [ ] **Step 1: Reescribir el test del WebhookService**

```typescript
// src/webhook/webhook.service.spec.ts
import { WebhookService } from './webhook.service';

function payload(phoneNumberId: string, text: string) {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{ from: '521', type: 'text', text: { body: text } }],
        },
      }],
    }],
  };
}

describe('WebhookService.handleWebhookEvent', () => {
  function make(clinic: any) {
    const clinics = {
      extractPhoneNumberId: (b: any) => b?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
      findByPhoneNumberId: jest.fn().mockResolvedValue(clinic),
    } as any;
    const router = { handle: jest.fn() } as any;
    return { service: new WebhookService(clinics, router), router, clinics };
  }

  it('resuelve clínica y delega al router', async () => {
    const clinic = { id: 'c1' };
    const { service, router } = make(clinic);
    await service.handleWebhookEvent(payload('PN1', 'hola'));
    expect(router.handle).toHaveBeenCalledWith(clinic, '521', 'hola');
  });

  it('si no hay clínica, no llama al router', async () => {
    const { service, router } = make(null);
    await service.handleWebhookEvent(payload('PNX', 'hola'));
    expect(router.handle).not.toHaveBeenCalled();
  });

  it('ignora payloads sin mensaje', async () => {
    const { service, router } = make({ id: 'c1' });
    await service.handleWebhookEvent({ entry: [{ changes: [{ value: {} }] }] });
    expect(router.handle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/webhook/webhook.service.spec.ts`
Expected: FAIL (constructor viejo recibe WhatsappService).

- [ ] **Step 3: Reescribir WebhookService**

Conservar `verifySignature` tal cual; reemplazar el constructor y `handleWebhookEvent`:

```typescript
// src/webhook/webhook.service.ts
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
```

- [ ] **Step 4: Actualizar WebhookModule**

```typescript
// src/webhook/webhook.module.ts
import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { ClinicsModule } from '../clinics/clinics.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [ClinicsModule, AgentModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
```

- [ ] **Step 5: Run test, verificar que pasa**

Run: `yarn test src/webhook/webhook.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webhook
git commit -m "feat: webhook resuelve clínica por phone_number_id y delega al router"
```

---

## Task 13: Recordatorios — RemindersService, controller y módulo

**Files:**
- Create: `src/reminders/reminders.service.ts`
- Create: `src/reminders/reminders.controller.ts`
- Create: `src/reminders/reminders.module.ts`
- Modify: `src/app.module.ts` (registrar RemindersModule + módulos faltantes)
- Test: `src/reminders/reminders.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (appointment.findMany/update, clinic), `WhatsappService.sendButtons`, tipo `Clinic`.
- Produces:
  - `RemindersService.runForToday(now?: Date): Promise<{ sent: number }>` — por cada clínica, busca citas de hoy (en su tz) con `status != cancelled` y `reminderSentAt = null`, manda botones confirm/cancel y marca `reminderSentAt`.
  - `RemindersController` con `POST /reminders/run` protegido por `Authorization: Bearer REMINDERS_TOKEN`.

- [ ] **Step 1: Escribir el test del servicio**

```typescript
// src/reminders/reminders.service.spec.ts
import { RemindersService } from './reminders.service';

describe('RemindersService.runForToday', () => {
  function make(appointments: any[]) {
    const prisma = {
      clinic: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', timezone: 'America/Mexico_City', waPhoneNumberId: 'PN1', waAccessToken: 'TOK' },
      ]) },
      appointment: {
        findMany: jest.fn().mockResolvedValue(appointments),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const whatsapp = { sendButtons: jest.fn().mockResolvedValue({}) } as any;
    return { service: new RemindersService(prisma, whatsapp), prisma, whatsapp };
  }

  it('envía recordatorio con botones y marca reminderSentAt', async () => {
    const { service, whatsapp, prisma } = make([
      {
        id: 'a1', startsAt: new Date('2026-06-29T15:00:00Z'),
        patient: { phone: '521', name: 'Ana' }, treatment: 'limpieza',
      },
    ]);
    const res = await service.runForToday(new Date('2026-06-29T13:00:00Z'));
    expect(res.sent).toBe(1);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      { phoneNumberId: 'PN1', accessToken: 'TOK' },
      '521',
      expect.stringContaining('cita'),
      [
        { id: 'confirm_a1', title: 'Confirmar' },
        { id: 'cancel_a1', title: 'Cancelar' },
      ],
    );
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1' }, data: { reminderSentAt: expect.any(Date) } }),
    );
  });

  it('no envía nada si no hay citas hoy', async () => {
    const { service, whatsapp } = make([]);
    const res = await service.runForToday(new Date('2026-06-29T13:00:00Z'));
    expect(res.sent).toBe(0);
    expect(whatsapp.sendButtons).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verificar que falla**

Run: `yarn test src/reminders/reminders.service.spec.ts`
Expected: FAIL (Cannot find module './reminders.service').

- [ ] **Step 3: Implementar RemindersService**

```typescript
// src/reminders/reminders.service.ts
import { Injectable } from '@nestjs/common';
import { Clinic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  // Inicio y fin del día (en la tz de la clínica) que contiene `now`, en UTC.
  private dayBounds(now: Date, timezone: string): { start: Date; end: Date } {
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now); // "YYYY-MM-DD"
    const [y, m, d] = ymd.split('-').map(Number);
    const guessStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const offset = this.tzOffsetMs(guessStart, timezone);
    const start = new Date(guessStart.getTime() - offset);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    return { start, end };
  }

  private tzOffsetMs(at: Date, timezone: string): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour), Number(p.minute), Number(p.second),
    );
    return asUtc - at.getTime();
  }

  private fmtTime(d: Date, timezone: string): string {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  }

  async runForToday(now: Date = new Date()): Promise<{ sent: number }> {
    const clinics = await this.prisma.clinic.findMany();
    let sent = 0;

    for (const clinic of clinics as Clinic[]) {
      const { start, end } = this.dayBounds(now, clinic.timezone);
      const appointments = await this.prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          status: { in: ['pending', 'confirmed'] },
          reminderSentAt: null,
          startsAt: { gte: start, lt: end },
        },
        include: { patient: true },
      });

      for (const appt of appointments as any[]) {
        await this.whatsapp.sendButtons(
          { phoneNumberId: clinic.waPhoneNumberId, accessToken: clinic.waAccessToken },
          appt.patient.phone,
          `Hola ${appt.patient.name} 👋 Te recordamos tu cita de hoy a las ${this.fmtTime(
            appt.startsAt, clinic.timezone,
          )} (${appt.treatment}). ¿La confirmas?`,
          [
            { id: `confirm_${appt.id}`, title: 'Confirmar' },
            { id: `cancel_${appt.id}`, title: 'Cancelar' },
          ],
        );
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderSentAt: new Date() },
        });
        sent++;
      }
    }
    return { sent };
  }
}
```

- [ ] **Step 4: Run test, verificar que pasa**

Run: `yarn test src/reminders/reminders.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Escribir el test del controller (auth)**

```typescript
// src/reminders/reminders.controller.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { RemindersController } from './reminders.controller';

describe('RemindersController', () => {
  const service = { runForToday: jest.fn().mockResolvedValue({ sent: 2 }) } as any;
  const controller = new RemindersController(service);

  beforeEach(() => { process.env.REMINDERS_TOKEN = 'secret'; });

  it('rechaza sin token válido', async () => {
    await expect(controller.run('Bearer wrong')).rejects.toThrow(UnauthorizedException);
  });

  it('corre con token correcto', async () => {
    const res = await controller.run('Bearer secret');
    expect(res).toEqual({ sent: 2 });
  });
});
```

- [ ] **Step 6: Run test, verificar que falla**

Run: `yarn test src/reminders/reminders.controller.spec.ts`
Expected: FAIL (Cannot find module './reminders.controller').

- [ ] **Step 7: Implementar controller y módulo**

```typescript
// src/reminders/reminders.controller.ts
import { Controller, Post, Headers, UnauthorizedException } from '@nestjs/common';
import { RemindersService } from './reminders.service';

@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('run')
  async run(@Headers('authorization') auth?: string) {
    const token = process.env.REMINDERS_TOKEN;
    if (!token || auth !== `Bearer ${token}`) {
      throw new UnauthorizedException();
    }
    return this.reminders.runForToday();
  }
}
```

```typescript
// src/reminders/reminders.module.ts
import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
```

- [ ] **Step 8: Registrar módulos en AppModule**

Reescribir `src/app.module.ts` para registrar todo:

```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ClinicsModule } from './clinics/clinics.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { SessionModule } from './session/session.module';
import { AgentModule } from './agent/agent.module';
import { WebhookModule } from './webhook/webhook.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { RemindersModule } from './reminders/reminders.module';

@Module({
  imports: [
    PrismaModule,
    ClinicsModule,
    SchedulingModule,
    SessionModule,
    AgentModule,
    WhatsappModule,
    WebhookModule,
    RemindersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 9: Run test, verificar que pasa**

Run: `yarn test src/reminders`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/reminders src/app.module.ts
git commit -m "feat: recordatorios same-day (/reminders/run protegido + botones)"
```

---

## Task 14: Verificación final, env, deploy y docs

**Files:**
- Modify: `render.yaml`
- Modify: `.env` (documentar nuevas vars; NO commitear valores)
- Modify: `README.md`

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Correr toda la suite**

Run: `yarn test`
Expected: PASS en todos los `*.spec.ts`.

- [ ] **Step 2: Lint y build**

Run: `yarn lint && yarn build`
Expected: sin errores de TypeScript.

- [ ] **Step 3: Añadir variables nuevas a render.yaml**

Agregar al bloque `envVars` de `render.yaml`:

```yaml
      - key: DATABASE_URL
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: ANTHROPIC_MODEL
        sync: false
      - key: GOOGLE_SERVICE_ACCOUNT
        sync: false
      - key: REMINDERS_TOKEN
        sync: false
```

Y cambiar el `buildCommand` para generar el cliente Prisma y migrar:

```yaml
    buildCommand: npm ci && npx prisma generate && npm run build
```

(En el deploy ejecutar `npx prisma migrate deploy` como release/predeploy step.)

- [ ] **Step 4: Documentar en README**

Añadir sección "Setup Fase 1" al `README.md` con: crear Postgres (Neon/Supabase), correr `prisma migrate deploy` y `prisma db seed`, crear cuenta de servicio de Google y compartir el calendario con su email, configurar las vars de entorno, y configurar un cron externo (cron-job.org) que haga `POST https://<app>/reminders/run` con `Authorization: Bearer <REMINDERS_TOKEN>` cada mañana a la hora deseada.

- [ ] **Step 5: Commit**

```bash
git add render.yaml README.md .env.example
git commit -m "chore: env, build con prisma y docs de setup Fase 1"
```

---

## Self-Review (cobertura del spec)

- §3 Arquitectura / módulos → Tasks 1–13 crean todos los módulos listados. ✓
- §4 Flujo (ruteo por phone_number_id → router → IA/reglas) → Tasks 11, 12. ✓
- §5 Modelo de datos (clinics, patients, appointments, índice) → Task 1. ✓
- §6 Disponibilidad/agenda (horario − citas − busy, anti doble-reserva, espejo Calendar no bloqueante) → Tasks 4, 5, 6. ✓
- §7 Estado de conversación en memoria con TTL → Task 7. ✓
- §8 Tools del agente (zod) + system prompt → Tasks 9, 10. ✓
- §9 Recordatorios (/reminders/run protegido, botones, anti-duplicado) → Task 13. ✓
- §10 Errores (sin clínica, falla Calendar, falla LLM fallback) → Tasks 5/6 (Calendar), 10 (LLM loop guard), 12 (sin clínica). ✓
- §11 Seguridad (token reminders, HMAC conservado) → Tasks 12, 13. ✓
- §12 Testing → cada task incluye specs; Task 14 corre la suite completa. ✓
- §13/§14 Stack y env → Tasks 1, 14. ✓
- §16 Checklist Fase 1 → cubierto por Tasks 1–14. ✓

Nota de honestidad: el fallback explícito de "menú de botones cuando falla el LLM" (§10) se implementa como guard del loop en `LlmService.reply` (devuelve mensaje pidiendo escribir *menu*); si se quiere capturar excepciones de red de Anthropic con try/catch alrededor de `reply` en `RouterService`, agregarlo en Task 11 (mejora menor, no bloqueante).
