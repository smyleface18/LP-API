import { SetMetadata } from '@nestjs/common';
import { UserRoles } from 'src/db/enum/roles.enum';

export const ROLES_KEY = UserRoles;
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
