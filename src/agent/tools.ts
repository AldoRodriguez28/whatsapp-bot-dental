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
