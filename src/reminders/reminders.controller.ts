// src/reminders/reminders.controller.ts
import {
  Controller,
  Post,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { RemindersService } from './reminders.service';

@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('run')
  async run(@Headers('authorization') auth?: string) {
    const token = process.env.REMINDERS_TOKEN;
    if (!token || auth !== `Bearer ${token}`) {
      throw new UnauthorizedException();
    }
    return this.reminders.runForToday();
  }
}
