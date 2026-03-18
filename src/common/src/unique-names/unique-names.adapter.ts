import { Injectable } from '@nestjs/common';
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';

@Injectable()
export class UniqueNamesAdapter {
  private readonly length = 3;
  private readonly dictionaries = [adjectives, animals, colors];

  NamesGenerator() {
    return uniqueNamesGenerator({
      dictionaries: this.dictionaries,
      length: this.length,
    });
  }
}
