import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { EnvsService } from 'src/common/envs/envs.service';
import { EnvsModule } from 'src/common/envs/envs.module';

@Module({
  imports: [
    EnvsModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [EnvsService],
      useFactory: (envs: EnvsService) => ({
        type: 'postgres',
        host: envs.dbHost,
        port: envs.dbPort,
        username: envs.dbUser,
        password: envs.dbPassword,
        database: envs.dbName,
        entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
        synchronize: false, // ❌ No sincronizar automáticamente
        migrations: [__dirname + '/../migrations/*{.ts,.js}'],
        migrationsRun: false, // ❌ No correr automáticamente
      }),
    }),
  ],
})
export class DatabaseModule {}
