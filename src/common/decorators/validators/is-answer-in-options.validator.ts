import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class AnswerInOptionsConstraint implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments): boolean {
    const obj = args.object as { options?: string[] };
    return Array.isArray(obj.options) && obj.options.includes(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `'${args.value}' must be one of the provided options.`;
  }
}

export function IsAnswerInOptions(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsAnswerInOptions',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: AnswerInOptionsConstraint,
    });
  };
}
