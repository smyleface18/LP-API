import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { MediaService } from './media.service';
import { PresignMediaDto } from './dto/presign-media.dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CognitoUser } from '../auth/type';
import { UserRoles } from '@/db/enum/roles.enum';

// Endpoints de administración de contenido (subir media para preguntas/opciones).
// La subida de avatar de usuario final es un flujo aparte (Cognito Identity Pool
// directo a S3), no pasa por este controller.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoles.ADMIN)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('presign')
  presign(@Body() dto: PresignMediaDto, @CurrentUser() user: CognitoUser) {
    // user.username (no user.sub) es el id que coincide con User.id en Postgres:
    // sub es el identificador interno que autogenera Cognito, distinto del
    // Username que se fija explícitamente en el signup (ver auth.service.ts).
    return this.mediaService.createPresignedUpload(dto, user.username);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.mediaService.confirm(id);
  }

  @Post('cleanup')
  cleanup() {
    return this.mediaService.cleanupOrphans();
  }
}
