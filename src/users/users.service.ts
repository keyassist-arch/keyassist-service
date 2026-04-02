import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, ShippingAddress } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async create(
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    phone?: string,
  ): Promise<User> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = this.users.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email,
      passwordHash,
      phone: phone ?? null,
    });
    return this.users.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  /** Case-insensitive match (for login hints / password reset). */
  async findByEmailInsensitive(email: string): Promise<User | null> {
    const trimmed = email.trim();
    return this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = LOWER(:email)', { email: trimmed })
      .getOne();
  }

  async findById(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async setRefreshTokenHash(
    userId: string,
    hash: string | null,
  ): Promise<void> {
    await this.users.update(userId, { refreshTokenHash: hash });
  }

  async updatePassword(userId: string, plainPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await this.users.update(userId, {
      passwordHash,
      refreshTokenHash: null,
    });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.users.update(userId, { emailVerifiedAt: new Date() });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.findById(userId);
    if (dto.firstName !== undefined) {
      user.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined) {
      user.lastName = dto.lastName.trim();
    }
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.defaultShippingAddress !== undefined) {
      user.defaultShippingAddress =
        dto.defaultShippingAddress as ShippingAddress;
    }
    return this.users.save(user);
  }

  toPublic(user: User) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
      phone: user.phone,
      defaultShippingAddress: user.defaultShippingAddress,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
