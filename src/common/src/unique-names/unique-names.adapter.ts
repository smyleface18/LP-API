import { Injectable } from '@nestjs/common';
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';

@Injectable()
export class UniqueNamesAdapter {
  private readonly length: number = 3;
  private readonly dictionaries: string[];

  constructor(length: number, dictionaries?: string[]) {
    this.length = length;
    if (dictionaries) {
      this.dictionaries = dictionaries;
    }
  }

  NamesGenerator() {
    return uniqueNamesGenerator({
      dictionaries: [adjectives, animals, colors],
      length: this.length,
    });
  }
}
