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
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
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
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const p = Object.fromEntries(
      dtf.formatToParts(at).map((x) => [x.type, x.value]),
    );
    const asUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    return asUtc - at.getTime();
  }

  private fmtTime(d: Date, timezone: string): string {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  }

  async runForToday(now: Date = new Date()): Promise<{ sent: number }> {
    const clinics = await this.prisma.clinic.findMany();
    let sent = 0;

    for (const clinic of clinics) {
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
        try {
          await this.whatsapp.sendButtons(
            {
              phoneNumberId: clinic.waPhoneNumberId,
              accessToken: clinic.waAccessToken,
            },
            appt.patient.phone,
            `Hola ${appt.patient.name} 👋 Te recordamos tu cita de hoy a las ${this.fmtTime(
              appt.startsAt,
              clinic.timezone,
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
        } catch (err) {
          console.error(
            `Reminder failed for appointment ${appt.id}:`,
            err,
          );
          // Do NOT increment sent; reminderSentAt stays null so it retries next run
        }
      }
    }
    return { sent };
  }
}
