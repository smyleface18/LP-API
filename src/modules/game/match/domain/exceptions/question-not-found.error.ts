export class QuestionNotFoundError extends Error {
  constructor(question: string) {
    super(`question with id ${question} not found`);
    this.name = 'QuestionNotFoundError';
  }
}
