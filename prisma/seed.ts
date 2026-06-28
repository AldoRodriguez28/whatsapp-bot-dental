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
