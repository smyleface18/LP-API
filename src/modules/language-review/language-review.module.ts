import { Module } from '@nestjs/common';
import { LanguageReviewer, NoErrorsLanguageReviewer } from './language-reviewer';

@Module({
  providers: [{ provide: LanguageReviewer, useClass: NoErrorsLanguageReviewer }],
  exports: [LanguageReviewer],
})
export class LanguageReviewModule {}
