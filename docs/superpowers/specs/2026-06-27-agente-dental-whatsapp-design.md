# Diseño: Agente de WhatsApp para clínicas dentales

**Fecha:** 2026-06-27
**Estado:** Aprobado para implementación (Fase 1)
**Proyecto base:** `whatsapp-bot-dental` (NestJS, desplegado en Render)

## 1. Objetivo

Convertir el bot actual (árbol de decisiones rígido con `if/else` sobre texto fijo) en un
**agente conversacional híbrido** que atiende pacientes de una clínica dental por WhatsApp:
gestiona disponibilidad de horarios, agenda citas y envía recordatorios el mismo día de la
cita con opción de confirmar o cancelar.

El producto está pensado como **multi-clínica**, pero este spec cubre la **Fase 1**: el flujo
completo end-to-end para **una sola clínica**, construido sobre un esquema de base de datos ya
multi-tenant y con ruteo por número de WhatsApp incluido. El alta de la clínica se hace
manualmente (seed/insert). El panel de administración y la facturación quedan para fases
posteriores.

## 2. Decisiones de diseño (tomadas en brainstorming)

| Tema | Decisión |
|---|---|
| Tipo de agente | **Híbrido**: reglas/botones para lo trivial (menú, precios, ubicación); Claude con tool-calling solo para texto libre |
| Fuente de verdad de citas | **Base de datos (Postgres)** como sistema de registro; **Google Calendar** como espejo operativo por clínica |
| Recordatorios | El mismo día de la cita, con botones **Confirmar** / **Cancelar** (cancelar libera el horario) |
| Disparo de recordatorios | Endpoint `POST /reminders/run` protegido, invocado por **cron externo gratis** (cron-job.org / GitHub Actions) |
| Duración de cita | **Fija** (configurable por clínica, ej. 30 min) |
| Persistencia de pacientes | **Sí**, tabla `patients` con historial; reconoce paciente recurrente |
| Alcance | **Multi-clínica**; Fase 1 = una clínica con esquema multi-tenant listo |
| Zona horaria | `America/Mexico_City` (configurable por clínica) |

## 3. Arquitectura

Se mantiene NestJS y la estructura actual. La capa de calendario/agenda (`scheduling`) es
**única** y la reutilizan tanto las reglas como la IA. Se agregan módulos nuevos.

```
src/
├─ webhook/          (existe) recibe mensajes, verifica firma → resuelve clínica → orquestador
├─ whatsapp/         (existe) sendText, sendButtons + sendList nuevo; recibe credenciales por clínica
├─ agent/            NUEVO  orquestador híbrido
│   ├─ router.service.ts        reglas/botones primero; si texto libre → IA
│   ├─ llm.service.ts           cliente Claude con tool-calling
│   └─ tools.ts                 definición de herramientas (zod) que Claude puede llamar
├─ scheduling/       NUEVO  capa única de agenda (lógica de negocio, sin saber de WhatsApp ni IA)
│   ├─ scheduling.service.ts    getAvailability, bookAppointment, cancelAppointment
│   └─ google-calendar.client.ts  wrapper de Google Calendar API (cuenta de servicio)
├─ reminders/        NUEVO  recordatorios
│   ├─ reminders.controller.ts  POST /reminders/run (protegido por token)
│   └─ reminders.service.ts     lee citas de hoy, manda recordatorio con botones, evita duplicados
├─ session/          NUEVO  estado de conversación en memoria (Map + TTL)
│   └─ session.service.ts
├─ clinics/          NUEVO  acceso a config de clínica (ruteo por phone_number_id)
│   └─ clinics.service.ts
└─ prisma/           NUEVO  Prisma schema + cliente
```

**Principios de aislamiento:**
- `scheduling` no conoce WhatsApp ni IA → testeable de forma aislada.
- `agent` nunca habla con Google directamente → siempre vía `scheduling`.
- La DB es el sistema de registro; Google Calendar es espejo (no bloquea agendar si falla).

## 4. Flujo general

1. `webhook` recibe el POST → verifica firma HMAC (ya implementada).
2. Extrae `value.metadata.phone_number_id` → `clinics.service` resuelve la **clínica**.
   Si no hay clínica para ese id, loguea y responde genérico (no rompe).
3. Pasa el mensaje + contexto de clínica al `agent/router`.
4. `router` resuelve con reglas/botones lo trivial (menú, precios, ubicación, botones de
   recordatorio). Texto libre que no encaja → `llm.service`.
5. `llm.service` (Claude) decide qué herramienta llamar; las herramientas usan
   `scheduling.service` → DB + Google Calendar de esa clínica.
6. Respuesta se envía vía `whatsapp` usando el token de la clínica.

Flujo de recordatorios (independiente):
1. Cron externo pega a `POST /reminders/run` con `Authorization: Bearer <REMINDERS_TOKEN>`.
2. `reminders.service` lee, por cada clínica, las citas de **hoy** con
   `status != cancelled` y `reminder_sent_at IS NULL`.
3. Por cada cita: `sendButtons` → recordatorio con **Confirmar** / **Cancelar**.
4. Marca `reminder_sent_at`. El botón entra por el webhook normal → actualiza/cancela la cita.

## 5. Modelo de datos (Postgres + Prisma)

```
clinics
  id                 uuid pk
  name               text
  timezone           text          (ej. "America/Mexico_City")
  working_hours      jsonb         (por día de semana: apertura/cierre)
  slot_minutes       int           (ej. 30)
  address            text
  prices_json        jsonb         (catálogo informativo de tratamientos/precios)
  wa_phone_number_id text UNIQUE   ← enruta el webhook
  wa_access_token    text          (cifrado en reposo)
  google_calendar_id text
  created_at         timestamptz

patients
  id          uuid pk
  clinic_id   uuid fk -> clinics
  phone       text          (normalizado E.164)
  name        text
  created_at  timestamptz
  UNIQUE (clinic_id, phone)

appointments
  id              uuid pk
  clinic_id       uuid fk -> clinics
  patient_id      uuid fk -> patients
  treatment       text
  starts_at       timestamptz
  ends_at         timestamptz
  status          enum (pending | confirmed | cancelled | no_show)
  google_event_id text          (id del evento espejo en Calendar; nullable)
  reminder_sent_at timestamptz  (nullable)
  created_at      timestamptz
  -- Red de seguridad contra doble reserva: índice único parcial sobre
  -- (clinic_id, starts_at) WHERE status IN ('pending','confirmed')
```

## 6. Disponibilidad y agenda

- **Disponibilidad** (`getAvailability({ date, treatment? })`):
  horario de la clínica para ese día (`working_hours`) − citas activas en DB − free/busy del
  Google Calendar de la clínica (para respetar bloqueos manuales del personal). Se parte en
  slots de `slot_minutes` y se devuelven los huecos libres.
- **Agendar** (`bookAppointment`): revalidar que el slot siga libre justo antes de crear
  (anti race condition); crear fila en `appointments` **y** evento en el Calendar de la clínica
  (guardar `google_event_id`). Si falla Calendar, la cita igual queda en DB y se marca para
  resync (Calendar es espejo, no bloquea).
- **Cancelar** (`cancelAppointment`): marca `status = cancelled` en DB y borra/actualiza el
  evento del Calendar → el hueco queda libre.
- **Paciente recurrente:** buscar por `(clinic_id, phone)`; si existe, saludo personalizado e
  historial disponible para el agente.

## 7. Estado de conversación (en memoria)

`Map<phone, { clinicId, intent, partialBooking?: { treatment?, date?, time? }, lastActivity }>`
con TTL ~15 min. Si se pierde por reinicio/sleep de Render, el bot simplemente vuelve a
preguntar lo faltante. No requiere DB.

## 8. Herramientas del agente (Claude, definidas con zod)

```
getAvailability({ date, treatment? })
  → huecos libres de la clínica para esa fecha.

bookAppointment({ phone, patientName, treatment, dateTime })
  → valida slot libre, crea cita en DB + evento en Calendar, devuelve confirmación.

cancelAppointment({ phone, dateTime? })
  → busca la cita del paciente y la cancela (libera hueco).

getClinicInfo({ topic })   // dirección, horarios, precios
  → respuestas informativas desde la config de la clínica.
```

**System prompt** de Claude incluye: identidad de la clínica (nombre, tono cálido en
español MX), reglas (nunca inventar horarios; siempre confirmar antes de agendar; pedir nombre
y tratamiento si faltan), y fecha/hora actual con la zona horaria de la clínica.

## 9. Recordatorios

`POST /reminders/run` (protegido con `Bearer REMINDERS_TOKEN`):
- Selecciona citas de **hoy** (zona horaria de cada clínica) con `status != cancelled` y
  `reminder_sent_at IS NULL`.
- Envía botones **Confirmar** / **Cancelar** vía WhatsApp con el token de la clínica.
- Marca `reminder_sent_at` para no duplicar.
- Las respuestas de los botones entran por el webhook normal y actualizan la cita
  (`confirmed`) o la cancelan (`cancelled`, liberando el hueco).

## 10. Manejo de errores y casos límite

- **Doble reserva:** revalidación previa + índice único parcial en DB como red de seguridad;
  si el slot ya no está, ofrecer otro horario.
- **`phone_number_id` sin clínica:** loguear y responder genérico, sin crash.
- **Falla de Google Calendar:** la cita persiste en DB; reintentar mirror y marcar para resync.
- **Falla de Claude/LLM:** fallback a menú de botones ("No te entendí bien, elige una opción 👇").
- **Webhook:** responder `200` siempre (ya implementado) + verificación de firma HMAC.
- **Paciente/cita no encontrada:** mensajes claros, nunca crash.

## 11. Seguridad

- `wa_access_token` cifrado en reposo.
- `/reminders/run` protegido con `Bearer REMINDERS_TOKEN`.
- Firma HMAC del webhook (`x-hub-signature-256`) ya implementada.
- Variables sensibles vía env (Render `sync: false`).

## 12. Testing (sin pegarle a APIs reales)

- **Unit `scheduling`:** cálculo de disponibilidad (horario − citas − busy); casos: día lleno,
  hueco al borde, fuera de horario. Mockea `google-calendar.client`.
- **Unit `agent/router`:** reglas vs ruteo a IA; LLM mockeado.
- **Unit `reminders`:** selecciona citas correctas de hoy; no duplica (`reminder_sent_at`).
- **Unit `webhook`/`clinics`:** ruteo por `phone_number_id`; manejo de confirmar/cancelar.
- **E2E:** payload de WhatsApp simulado → respuesta esperada, con `TEST_MODE` y DB de prueba.
- Se mantiene `TEST_MODE` para no gastar API de WhatsApp.

## 13. Stack y dependencias nuevas

- **Prisma** + **Postgres** (gratis: Neon / Supabase / Render Postgres).
- **SDK de Anthropic** (`@anthropic-ai/sdk`) para Claude con tool-calling. Modelo por defecto:
  el Claude más capaz/actual disponible (verificar id vigente al implementar, ej. familia
  Claude 4.x).
- **Google Calendar API** (`googleapis`) con cuenta de servicio.
- Se conserva: NestJS 11, `zod`, verificación HMAC, `TEST_MODE`, despliegue en Render.

## 14. Variables de entorno nuevas (además de las actuales)

```
DATABASE_URL              # Postgres
ANTHROPIC_API_KEY         # Claude
GOOGLE_SERVICE_ACCOUNT    # credenciales JSON de la cuenta de servicio (o ruta/secret)
REMINDERS_TOKEN           # protege POST /reminders/run
ENCRYPTION_KEY            # cifrado de wa_access_token
```

## 15. Fuera de alcance (fases posteriores)

- **Fase 2:** panel de administración para alta self-service de clínicas y credenciales de
  WhatsApp; reportes/estadísticas; reconocimiento avanzado de historial.
- **Fase 3:** planes y facturación.

## 16. Fase 1 — checklist de entregables

1. Esquema Prisma + migración (clinics, patients, appointments) y seed de una clínica.
2. `clinics.service` con ruteo por `phone_number_id`.
3. `scheduling` (disponibilidad, agendar, cancelar) + `google-calendar.client`.
4. `agent` (router híbrido + Claude tool-calling + tools zod).
5. `session.service` en memoria con TTL.
6. `reminders` (`/reminders/run` protegido + envío con botones + anti-duplicado).
7. Integración en `webhook` (resolver clínica → orquestador; manejo de botones confirmar/cancelar).
8. `whatsapp` parametrizado por credenciales de clínica + `sendList`.
9. Tests unitarios y e2e descritos en §12.
10. Documentar setup (DB, Google service account, cron externo) en README.
