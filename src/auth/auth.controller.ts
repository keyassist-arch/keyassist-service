import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { Request } from 'express';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(
      dto.firstName,
      dto.lastName,
      dto.email,
      dto.password,
      dto.phone,
    );
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token, dto.localCart);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('resend-verification')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password, dto.localCart);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password).then(() => ({
      message:
        'Password has been reset. Sign in with your new password; existing sessions were signed out.',
    }));
  }

  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('refresh')
  refresh(
    @Req() req: Request & { user: JwtPayload },
    @Body() _body: RefreshDto,
  ) {
    const u = req.user;
    return this.authService.rotateRefresh(u.sub, u.email, u.role);
  }
}
