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
