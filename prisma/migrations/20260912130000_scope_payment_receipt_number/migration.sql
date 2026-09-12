-- Drop the global unique index on Payment.receiptNumber
DROP INDEX IF EXISTS "Payment_receiptNumber_key";

-- Create composite unique index on (restaurantId, receiptNumber)
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_restaurantId_receiptNumber_key" ON "Payment"("restaurantId", "receiptNumber");


