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
    expect(() =>
      parseWorkingHours({ '1': { open: '9am', close: '19:00' } }),
    ).toThrow();
  });
});
