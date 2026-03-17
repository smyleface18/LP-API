import { Module } from '@nestjs/common';
import { UniqueNamesAdapter } from './unique-names.adapter';

@Module({
  providers: [UniqueNamesAdapter],
  exports: [UniqueNamesAdapter],
})
export class UniqueNamesModule {}
