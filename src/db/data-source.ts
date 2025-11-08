import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { ENTITIES } from './database.module';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: ENTITIES,
  synchronize: false, // ❌ No sincronizar automáticamente
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsRun: false, // ❌ No correr automáticamente
});
