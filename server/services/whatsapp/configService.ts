import { prisma } from '../../db/prisma';
import { encryptToken, decryptToken } from './encryption';
import { WhatsAppProvider } from './provider';
import { config } from '../../config';

/**
 * WhatsApp integration config service — tenant isolated.
 * Handles CRUD for per-restaurant WhatsApp configuration.
 * Never returns secrets via API.
 */

export interface WhatsAppConfigInput {
  enabled?: boolean;
  phoneNumberId?: string;
  wabaId?: string;
  accessToken?: string;
  displayPhoneNumber?: string;
  status?: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'FAILED';
  metadata?: any;
}

export interface SafeWhatsAppConfig {
  id: string;
  restaurantId: string;
  enabled: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  status: string;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
  hasAccessToken: boolean;
  isGlobalFallback: boolean;
}

function toSafeConfig(
  integration: any,
  opts?: { isGlobalFallback?: boolean }
): SafeWhatsAppConfig {
  return {
    id: integration.id || 'global-fallback',
    restaurantId: integration.restaurantId,
    enabled: !!integration.enabled,
    phoneNumberId: integration.phoneNumberId || null,
    wabaId: integration.wabaId || null,
    displayPhoneNumber: integration.displayPhoneNumber || null,
    status: integration.status || 'PENDING',
    metadata: integration.metadata || null,
    createdAt: integration.createdAt || new Date(),
    updatedAt: integration.updatedAt || new Date(),
    hasAccessToken: !!integration.accessToken,
    isGlobalFallback: !!opts?.isGlobalFallback,
  };
}

export async function getWhatsAppIntegration(restaurantId: string) {
  const integration = await prisma.whatsAppIntegration.findUnique({
    where: { restaurantId },
  });
  return integration;
}

export async function getSafeWhatsAppConfig(restaurantId: string): Promise<SafeWhatsAppConfig | null> {
  const integration = await prisma.whatsAppIntegration.findUnique({
    where: { restaurantId },
  });

  if (!integration) {
    // Check global fallback
    if (config.whatsappPhoneNumberId && config.whatsappAccessToken) {
      return toSafeConfig(
        {
          id: 'global-fallback',
          restaurantId,
          enabled: config.whatsappEnabled,
          phoneNumberId: config.whatsappPhoneNumberId,
          wabaId: config.whatsappWabaId,
          displayPhoneNumber: null,
          status: config.whatsappEnabled ? 'ACTIVE' : 'DISABLED',
          metadata: null,
          accessToken: config.whatsappAccessToken ? '***' : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { isGlobalFallback: true }
      );
    }
    return null;
  }

  return toSafeConfig(integration);
}

export async function upsertWhatsAppIntegration(
  restaurantId: string,
  input: WhatsAppConfigInput
): Promise<SafeWhatsAppConfig> {
  const existing = await prisma.whatsAppIntegration.findUnique({
    where: { restaurantId },
  });

  let encryptedToken: string | undefined;
  if (input.accessToken) {
    encryptedToken = encryptToken(input.accessToken);
  }

  const data: any = {
    enabled: input.enabled !== undefined ? input.enabled : existing?.enabled ?? false,
    phoneNumberId: input.phoneNumberId !== undefined ? input.phoneNumberId : existing?.phoneNumberId,
    wabaId: input.wabaId !== undefined ? input.wabaId : existing?.wabaId,
    displayPhoneNumber: input.displayPhoneNumber !== undefined ? input.displayPhoneNumber : existing?.displayPhoneNumber,
    status: input.status || existing?.status || 'PENDING',
    metadata: input.metadata !== undefined ? input.metadata : existing?.metadata,
  };

  if (encryptedToken) {
    data.accessToken = encryptedToken;
  }

  // Auto-set status based on completeness
  if (data.enabled && data.phoneNumberId && (data.accessToken || existing?.accessToken || config.whatsappAccessToken)) {
    if (!data.status || data.status === 'PENDING') {
      data.status = 'ACTIVE';
    }
  } else if (data.enabled === false) {
    data.status = 'DISABLED';
  }

  const upserted = await prisma.whatsAppIntegration.upsert({
    where: { restaurantId },
    create: {
      restaurantId,
      ...data,
    },
    update: data,
  });

  return toSafeConfig(upserted);
}

export async function getWhatsAppProviderForRestaurant(restaurantId: string): Promise<WhatsAppProvider | null> {
  const integration = await prisma.whatsAppIntegration.findUnique({
    where: { restaurantId },
  });

  // If no integration or disabled, check if global fallback is allowed and enabled
  if (!integration) {
    if (!config.whatsappEnabled) return null;
    return WhatsAppProvider.fromGlobalConfig();
  }

  if (!integration.enabled) return null;
  if (integration.status === 'DISABLED') return null;
  if (!integration.phoneNumberId) {
    // Try global fallback if tenant doesn't have phoneNumberId but global does
    if (config.whatsappPhoneNumberId && config.whatsappAccessToken) {
      return WhatsAppProvider.fromGlobalConfig();
    }
    return null;
  }

  // Decrypt token for provider creation (provider handles decryption internally too)
  let token = integration.accessToken;
  if (!token) {
    // Fallback to global token if tenant token missing
    token = config.whatsappAccessToken || null;
    if (!token) return null;
  }

  // Try to decrypt to validate, but pass encrypted to provider (it decrypts again)
  // Actually pass the stored value, provider will decrypt
  return WhatsAppProvider.fromIntegration({
    phoneNumberId: integration.phoneNumberId,
    accessToken: token,
    wabaId: integration.wabaId,
  });
}

export async function isWhatsAppEnabledForRestaurant(restaurantId: string): Promise<boolean> {
  if (!config.whatsappEnabled && !config.whatsappPhoneNumberId) {
    // Globally disabled, but check tenant override
    const integration = await prisma.whatsAppIntegration.findUnique({
      where: { restaurantId },
      select: { enabled: true, status: true, phoneNumberId: true, accessToken: true },
    });
    if (!integration) return false;
    return !!integration.enabled && !!integration.phoneNumberId && (!!integration.accessToken || !!config.whatsappAccessToken);
  }

  const provider = await getWhatsAppProviderForRestaurant(restaurantId);
  return !!provider;
}

export async function deleteWhatsAppIntegration(restaurantId: string): Promise<void> {
  await prisma.whatsAppIntegration.delete({
    where: { restaurantId },
  });
}
