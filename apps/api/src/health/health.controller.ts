import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@btu-course-watch/contracts';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Check API health' })
  @ApiOkResponse({
    description: 'The API process is healthy.',
    schema: {
      example: {
        status: 'ok',
        service: 'btu-course-watch-api',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'btu-course-watch-api',
      timestamp: new Date().toISOString(),
    };
  }
}
