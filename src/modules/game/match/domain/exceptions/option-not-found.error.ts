export class OptionNotFoundError extends Error {
  constructor(optionId: string) {
    super(`Option with id ${optionId} not found`);
    this.name = 'OptionNotFoundError';
  }
}
