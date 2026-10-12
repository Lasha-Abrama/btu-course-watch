import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validateEnvironment } from '../config/environment.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import {
  EmailDeliveryOperations,
  parseOperationsCommand,
} from './email-delivery.operations.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
  ],
  providers: [EmailDeliveryOperations],
})
class EmailOperationsModule {}

async function run(): Promise<void> {
  const command = parseOperationsCommand(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(
    EmailOperationsModule,
    {
      logger: false,
    },
  );
  try {
    const operations = app.get(EmailDeliveryOperations);
    if (command.kind === 'status' || command.kind === 'failed') {
      const result =
        command.kind === 'status'
          ? await operations.status()
          : await operations.failed(command.page);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const result = await operations.recover(command);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (
        !['dry-run-eligible', 'requeued', 'already-recovered'].includes(
          result.outcome,
        )
      )
        process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

void run().catch(() => {
  process.stderr.write(
    'Email operations failed; check arguments, configuration, migrations, and database access.\n',
  );
  process.exitCode = 1;
});
