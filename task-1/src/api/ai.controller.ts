import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { QuotaService } from '../quota/quota.service';
import { AiRequestDto } from './dto';

@Controller('v1/ai')
export class AiController {
  constructor(private readonly quota: QuotaService) {}

  @Post('requests')
  async createRequest(
    @Body() body: AiRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request & { requestId?: string },
  ) {
    const requestId = req.requestId ?? 'unknown';
    return this.quota.handleAiRequest(body, idempotencyKey, requestId);
  }
}
