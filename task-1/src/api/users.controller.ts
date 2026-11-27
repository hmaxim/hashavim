import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { QuotaService } from '../quota/quota.service';
import { SetLimitDto } from './dto';

@Controller('v1/users')
export class UsersController {
  constructor(private readonly quota: QuotaService) {}

  @Get(':userId/usage')
  getUsage(
    @Param('userId') userId: string,
    @Query('includeRecent') includeRecent?: string,
  ) {
    return this.quota.getUsage(userId, includeRecent === 'true' || includeRecent === '1');
  }

  @Put(':userId/limit')
  setLimit(@Param('userId') userId: string, @Body() body: SetLimitDto) {
    return this.quota.setUserLimit(userId, body.limit);
  }
}
