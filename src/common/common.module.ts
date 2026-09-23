import { Module } from '@nestjs/common';
import { StorageModule } from './src/storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [],
  exports: [],
})
export class CommonModule {}
