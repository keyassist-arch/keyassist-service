import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PasskeyService } from './passkey.service';

class RenameCredentialDto {
  @IsString()
  @MaxLength(128)
  friendlyName: string;
}

class FinishRegistrationDto {
  // The WebAuthn credential response is an opaque object validated by simplewebauthn internally.
  @IsObject()
  response: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  friendlyName?: string;
}

@ApiTags('Authentication')
@Controller('auth/passkey')
export class PasskeyController {
  constructor(private readonly passkeyService: PasskeyService) {}

  // ── Registration (requires logged-in user) ──────────────────────────────

  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Begin passkey registration for the current user' })
  @Post('register/start')
  registerStart(@CurrentUser() user: JwtPayload) {
    return this.passkeyService.startRegistration(user.sub);
  }

  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Complete passkey registration and save the credential',
  })
  @Post('register/finish')
  registerFinish(
    @CurrentUser() user: JwtPayload,
    @Body() dto: FinishRegistrationDto,
  ) {
    return this.passkeyService.finishRegistration(
      user.sub,
      dto.response,
      dto.friendlyName,
    );
  }

  // ── Authentication (public) ──────────────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Begin passkey authentication (returns challenge)' })
  @Post('login/start')
  loginStart() {
    return this.passkeyService.startAuthentication();
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Complete passkey authentication — returns accessToken + refreshToken',
  })
  @Post('login/finish')
  loginFinish(@Body() body: AuthenticationResponseJSON) {
    return this.passkeyService.finishAuthentication(body);
  }

  // ── Credential management (requires auth) ───────────────────────────────

  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the current user's registered passkeys" })
  @Get('credentials')
  listCredentials(@CurrentUser() user: JwtPayload) {
    return this.passkeyService.listCredentials(user.sub);
  }

  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Rename a passkey' })
  @Patch('credentials/:id')
  renameCredential(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameCredentialDto,
  ) {
    return this.passkeyService.renameCredential(user.sub, id, dto.friendlyName);
  }

  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Remove a passkey' })
  @Delete('credentials/:id')
  removeCredential(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.passkeyService.removeCredential(user.sub, id);
  }
}
