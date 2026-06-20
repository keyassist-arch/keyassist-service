import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { Cart } from '../cart/entities/cart.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { ImportedProduct } from '../products/entities/imported-product.entity';
import { Product } from '../products/entities/product.entity';
import { OrderTracking } from '../tracking/entities/order-tracking.entity';
import { User } from '../users/entities/user.entity';
import { Refund } from '../reconciliation/entities/refund.entity';
import { CustomerIssue } from '../reconciliation/entities/customer-issue.entity';
import { ShippingRates } from '../shipping/entities/shipping-rates.entity';
import { SavedPaymentMethod } from '../payment/entities/saved-payment-method.entity';
import { AddProductRescrapeEnabled1743130800000 } from './migrations/1743130800000-AddProductRescrapeEnabled';
import { ClearProductFkOnFailedImports1743200000000 } from './migrations/1743200000000-ClearProductFkOnFailedImports';
import { AddProductSourceShein1743280000000 } from './migrations/1743280000000-AddProductSourceShein';
import { AddProductConfigurationPrices1743320000000 } from './migrations/1743320000000-AddProductConfigurationPrices';
import { AddProductSlug1743340000000 } from './migrations/1743340000000-AddProductSlug';
import { AddUserEmailVerifiedAt1743400000000 } from './migrations/1743400000000-AddUserEmailVerifiedAt';
import { AddProductSourceGoatZaraConverse1743410000000 } from './migrations/1743410000000-AddProductSourceGoatZaraConverse';
import { AddUserTotp1743600000000 } from './migrations/1743600000000-AddUserTotp';
import { PatchOrderTracking1743700000000 } from './migrations/1743700000000-PatchOrderTracking';
import { AddReconciliationTables1743800000000 } from './migrations/1743800000000-AddReconciliationTables';
import { AddOrderDiscount1746720000000 } from './migrations/1746720000000-AddOrderDiscount';
import { AddOrderShippingFee1746720001000 } from './migrations/1746720001000-AddOrderShippingFee';
import { CreateShippingRates1746720002000 } from './migrations/1746720002000-CreateShippingRates';
import { CreateSavedProducts1746720003000 } from './migrations/1746720003000-CreateSavedProducts';
import { CreatePasskeyCredentials1746720004000 } from './migrations/1746720004000-CreatePasskeyCredentials';
import { AddOrderLandedCostColumns1746720005000 } from './migrations/1746720005000-AddOrderLandedCostColumns';
import { CreateCategories1746720006000 } from './migrations/1746720006000-CreateCategories';
import { AddProductAsin1780272000000 } from './migrations/1780272000000-AddProductAsin';
import { AddSavedPaymentMethods1780800000000 } from './migrations/1780800000000-AddSavedPaymentMethods';

config({ path: resolve(process.cwd(), '.env') });

export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce',
  entities: [
    User,
    Product,
    ImportedProduct,
    Cart,
    CartItem,
    Order,
    OrderItem,
    OrderTracking,
    Refund,
    CustomerIssue,
    ShippingRates,
    SavedPaymentMethod,
  ],
  migrations: [
    AddProductRescrapeEnabled1743130800000,
    ClearProductFkOnFailedImports1743200000000,
    AddProductSourceShein1743280000000,
    AddProductConfigurationPrices1743320000000,
    AddProductSlug1743340000000,
    AddUserEmailVerifiedAt1743400000000,
    AddProductSourceGoatZaraConverse1743410000000,
    AddUserTotp1743600000000,
    PatchOrderTracking1743700000000,
    AddReconciliationTables1743800000000,
    AddOrderDiscount1746720000000,
    AddOrderShippingFee1746720001000,
    CreateShippingRates1746720002000,
    CreateSavedProducts1746720003000,
    CreatePasskeyCredentials1746720004000,
    AddOrderLandedCostColumns1746720005000,
    CreateCategories1746720006000,
    AddProductAsin1780272000000,
    AddSavedPaymentMethods1780800000000,
  ],
  synchronize: false,
});
