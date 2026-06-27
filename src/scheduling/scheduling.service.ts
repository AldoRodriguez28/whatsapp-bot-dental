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
}
