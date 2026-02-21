import { Module } from '@nestjs/common';
import { CacheModule } from './cache/cache.module';
import { CommonService } from '../common.module';

@Module({
  imports: [CacheModule],
  providers: [CommonService],
  exports: [CommonService, CacheModule],
})
export class CommonModule {}
