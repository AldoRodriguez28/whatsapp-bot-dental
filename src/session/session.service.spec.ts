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
