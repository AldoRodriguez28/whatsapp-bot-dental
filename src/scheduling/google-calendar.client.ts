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
