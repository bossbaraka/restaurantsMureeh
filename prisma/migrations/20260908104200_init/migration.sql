-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('PLATFORM_ADMIN', 'SUPER_ADMIN', 'RESTAURANT_MANAGER', 'STAFF', 'WAITER', 'KITCHEN', 'CASHIER');

-- CreateEnum
CREATE TYPE "RestaurantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ONBOARDING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'BILL_REQUESTED', 'RESERVED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "TableZone" AS ENUM ('MAIN_HALL', 'TERRACE', 'VIP_LOUNGE', 'GARDEN');

-- CreateEnum
CREATE TYPE "WaiterRequestStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "description" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT '₪',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "status" "RestaurantStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryColor" TEXT NOT NULL DEFAULT '#D4AF37',
    "accentColor" TEXT NOT NULL DEFAULT '#C5A880',
    "promoVideoUrl" TEXT,
    "galleryImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customDomain" TEXT,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantUser" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "role" "TenantRole" NOT NULL DEFAULT 'RESTAURANT_MANAGER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "priceMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceYearly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billingPeriod" TEXT NOT NULL DEFAULT 'monthly',
    "maxTables" INTEGER NOT NULL DEFAULT 50,
    "maxCategories" INTEGER NOT NULL DEFAULT 20,
    "maxProducts" INTEGER NOT NULL DEFAULT 150,
    "entitlements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "zone" "TableZone" NOT NULL DEFAULT 'MAIN_HALL',
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "qrToken" TEXT NOT NULL,
    "hasWaiterCall" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3),
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "image" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "badge" TEXT,
    "preparationTimeMinutes" INTEGER DEFAULT 15,
    "calories" INTEGER,
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ingredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "removableIngredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceModifier" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "numericId" SERIAL NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT NOT NULL DEFAULT 'PAY AT CASHIER',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "settledAt" TIMESTAMP(3),
    "cashierId" TEXT,
    "branchId" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "estimatedPrepMinutes" INTEGER DEFAULT 18,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "productNameEnSnapshot" TEXT,
    "priceSnapshot" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "selectedSize" TEXT,
    "selectedAddOns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "removedIngredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialInstructions" TEXT,
    "notes" TEXT,
    "totalPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiterRequest" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "sessionId" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'ASSISTANCE',
    "reasonText" TEXT,
    "status" "WaiterRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WaiterRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleEn" TEXT,
    "subtitle" TEXT,
    "description" TEXT,
    "image" TEXT,
    "originalPrice" DOUBLE PRECISION,
    "discountedPrice" DOUBLE PRECISION,
    "discountPercentage" DOUBLE PRECISION,
    "badge" TEXT DEFAULT '╪╣╪▒╪╢ ╪«╪º╪╡',
    "bgGradient" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "actorRole" "TenantRole" NOT NULL DEFAULT 'RESTAURANT_MANAGER',
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "details" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "tableId" TEXT NOT NULL,
    "tableLabel" TEXT NOT NULL,
    "orderIds" TEXT[],
    "itemsSummary" TEXT,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "cashReceived" DOUBLE PRECISION,
    "changeDue" DOUBLE PRECISION,
    "tip" DOUBLE PRECISION,
    "cashierId" TEXT,
    "cashierName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");

-- CreateIndex
CREATE INDEX "Restaurant_slug_idx" ON "Restaurant"("slug");

-- CreateIndex
CREATE INDEX "Restaurant_status_idx" ON "Restaurant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantUser_email_key" ON "RestaurantUser"("email");

-- CreateIndex
CREATE INDEX "RestaurantUser_email_idx" ON "RestaurantUser"("email");

-- CreateIndex
CREATE INDEX "RestaurantUser_restaurantId_idx" ON "RestaurantUser"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_restaurantId_key" ON "Subscription"("restaurantId");

-- CreateIndex
CREATE INDEX "Subscription_restaurantId_idx" ON "Subscription"("restaurantId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Table_qrToken_key" ON "Table"("qrToken");

-- CreateIndex
CREATE INDEX "Table_restaurantId_idx" ON "Table"("restaurantId");

-- CreateIndex
CREATE INDEX "Table_status_idx" ON "Table"("status");

-- CreateIndex
CREATE INDEX "Table_qrToken_idx" ON "Table"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "Table_restaurantId_number_key" ON "Table"("restaurantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_sessionToken_key" ON "TableSession"("sessionToken");

-- CreateIndex
CREATE INDEX "TableSession_restaurantId_idx" ON "TableSession"("restaurantId");

-- CreateIndex
CREATE INDEX "TableSession_tableId_idx" ON "TableSession"("tableId");

-- CreateIndex
CREATE INDEX "TableSession_sessionToken_idx" ON "TableSession"("sessionToken");

-- CreateIndex
CREATE INDEX "Category_restaurantId_idx" ON "Category"("restaurantId");

-- CreateIndex
CREATE INDEX "Category_sortOrder_idx" ON "Category"("sortOrder");

-- CreateIndex
CREATE INDEX "Product_restaurantId_idx" ON "Product"("restaurantId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_available_idx" ON "Product"("available");

-- CreateIndex
CREATE INDEX "ProductOption_productId_idx" ON "ProductOption"("productId");

-- CreateIndex
CREATE INDEX "AddOn_productId_idx" ON "AddOn"("productId");

-- CreateIndex
CREATE INDEX "Order_restaurantId_idx" ON "Order"("restaurantId");

-- CreateIndex
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "WaiterRequest_restaurantId_idx" ON "WaiterRequest"("restaurantId");

-- CreateIndex
CREATE INDEX "WaiterRequest_tableId_idx" ON "WaiterRequest"("tableId");

-- CreateIndex
CREATE INDEX "WaiterRequest_status_idx" ON "WaiterRequest"("status");

-- CreateIndex
CREATE INDEX "Offer_restaurantId_idx" ON "Offer"("restaurantId");

-- CreateIndex
CREATE INDEX "Offer_isActive_idx" ON "Offer"("isActive");

-- CreateIndex
CREATE INDEX "AuditLog_restaurantId_idx" ON "AuditLog"("restaurantId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Branch_restaurantId_idx" ON "Branch"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_restaurantId_idx" ON "Payment"("restaurantId");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_method_idx" ON "Payment"("method");

-- AddForeignKey
ALTER TABLE "RestaurantUser" ADD CONSTRAINT "RestaurantUser_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiterRequest" ADD CONSTRAINT "WaiterRequest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiterRequest" ADD CONSTRAINT "WaiterRequest_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiterRequest" ADD CONSTRAINT "WaiterRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "RestaurantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

