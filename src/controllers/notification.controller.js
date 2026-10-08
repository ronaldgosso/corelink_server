import { fcmService } from '../services/fcm.service.js';

/**
 * Registers an FCM device token for the authenticated user
 * POST /api/notifications/register-token
 */
export const handleRegisterDeviceToken = async (req, res, next) => {
  try {
    const { token, platform, deviceName } = req.body;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: token',
      });
    }

    const registration = await fcmService.registerToken({
      userId: req.user.id,
      token: token.trim(),
      platform: platform || 'android',
      deviceName: deviceName || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Device registration token saved successfully',
      data: {
        id: registration.id,
        platform: registration.platform,
        createdAt: registration.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unregisters an FCM device token (e.g., on logout)
 * POST /api/notifications/unregister-token
 */
export const handleUnregisterDeviceToken = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: token',
      });
    }

    await fcmService.unregisterToken({
      userId: req.user.id,
      token: token.trim(),
    });

    return res.status(200).json({
      success: true,
      message: 'Device token removed successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieves push notification status & registered device count
 * GET /api/notifications/status
 */
export const handleGetNotificationStatus = async (req, res, next) => {
  try {
    const tokens = await fcmService.getUserTokens(req.user.id);

    return res.status(200).json({
      success: true,
      data: {
        isConfiguredOnServer: fcmService.isConfigured,
        registeredDevicesCount: tokens.length,
      },
    });
  } catch (error) {
    next(error);
  }
};
