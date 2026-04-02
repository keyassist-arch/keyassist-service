import { UserRole } from '../../common/enums/role.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
