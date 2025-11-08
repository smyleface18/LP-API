import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { Question } from 'src/db/entities';

export function IsQuestionProvided(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isQuestionProvided',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(_: any, args: ValidationArguments) {
          const obj = args.object as Question;
          return !!obj.questionText || !!obj.questionImage; // Al menos uno debe existir
        },
        /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        defaultMessage(_: ValidationArguments) {
          return 'At least one text or image must be provided for the question.';
        },
      },
    });
  };
}
