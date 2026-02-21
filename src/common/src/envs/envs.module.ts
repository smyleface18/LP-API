import { Global, Module } from '@nestjs/common';
import { EnvsService } from './envs.service';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  providers: [EnvsService],
  exports: [EnvsService],
})
export class EnvsModule {}
