import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Question } from 'src/db/entities';

// 1️⃣ Creamos el constraint (validador)
@ValidatorConstraint({ async: false })
export class AtLeastOneConstraint implements ValidatorConstraintInterface {
  validate(_: any, args: ValidationArguments) {
    const obj = args.object as Question;
    // Al menos uno de los dos campos debe existir
    return !!(obj.questionText || obj.questionImage);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  defaultMessage(args: ValidationArguments) {
    return 'At least one text or image must be provided for the question.';
  }
}

// 2️⃣ Función que usamos como decorator de clase
export function AtLeastOne(validationOptions?: ValidationOptions) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function) {
    registerDecorator({
      target: target,
      propertyName: '', // necesario aunque sea a nivel de clase
      options: validationOptions,
      validator: AtLeastOneConstraint,
    });
  };
}

// 3️⃣ DTO donde aplicamos el validador
@AtLeastOne({ message: 'Debe haber texto o imagen' })
export class CreateQuestionDto {
  questionText?: string; // Texto de la pregunta
  questionImage?: string; // URL de la imagen, si aplica
}
