import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { QuotaService } from '../quota/quota.service';
import { SetLimitDto } from './dto';

@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly quota: QuotaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':userId/usage')
  getUsage(
    @Param('userId') userId: string,
    @Query('includeRecent') includeRecent?: string,
  ) {
    return this.quota.getUsage(userId, includeRecent === 'true' || includeRecent === '1');
  }

  @Put(':userId/limit')
  setLimit(
    @Param('userId') userId: string,
    @Body() body: SetLimitDto,
    @Headers('x-admin-token') token: string | undefined,
  ) {
    this.requireAdmin(token);
    return this.quota.setUserLimit(userId, body.limit);
  }

  private requireAdmin(token: string | undefined): void {
    const expected = this.config.adminToken;
    if (!expected) {
      throw new ForbiddenException('Admin routes are disabled (ADMIN_TOKEN not set)');
    }
    const given = Buffer.from(token ?? '');
    const want = Buffer.from(expected);
    // Constant-time compare so the token cannot be guessed byte by byte from timing.
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new ForbiddenException('Invalid admin token');
    }
  }
}
