// uuid@13 solo se publica como ESM y Jest corre en CommonJS: en tests se
// reemplaza por este shim (ver moduleNameMapper en package.json).
import { randomUUID } from 'crypto';

export const v4 = (): string => randomUUID();
