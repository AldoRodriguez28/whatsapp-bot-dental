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
          data: {
            calendars: {
              cal1: {
                busy: [
                  {
                    start: '2026-06-29T10:00:00Z',
                    end: '2026-06-29T10:30:00Z',
                  },
                ],
              },
            },
          },
        }),
      },
    };
    const client = makeClient(calendarApi);
    const busy = await client.getBusy(
      'cal1',
      new Date('2026-06-29T00:00:00Z'),
      new Date('2026-06-29T23:59:00Z'),
    );
    expect(busy).toHaveLength(1);
    expect(busy[0].start).toEqual(new Date('2026-06-29T10:00:00Z'));
  });

  it('createEvent regresa el id del evento', async () => {
    const calendarApi = {
      events: {
        insert: jest.fn().mockResolvedValue({ data: { id: 'evt123' } }),
      },
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
