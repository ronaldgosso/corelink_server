import { AuthService } from '../services/auth.service.js';

export const handleLinkedInExchange = async (req, res) => {
  try {
    const { code, redirectUri, redirect_uri } = req.body;
    const finalRedirectUri = redirectUri || redirect_uri;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required in request body (e.g. { "code": "..." }).',
      });
    }

    const result = await AuthService.exchangeLinkedInCode({
      code,
      redirectUri: finalRedirectUri,
    });

    return res.status(200).json({
      success: true,
      message: 'LinkedIn authentication successful',
      token: result.token,
      profile: result.profile,
      user: result.profile,
    });
  } catch (error) {
    console.error('LinkedIn exchange error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'LinkedIn authentication failed',
    });
  }
};

export const handleGetMe = async (req, res) => {
  try {
    const profile = await AuthService.getProfile(req.user.id);
    return res.status(200).json({
      success: true,
      profile,
      user: profile,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve profile',
    });
  }
};

export const handleDisconnect = async (req, res) => {
  try {
    const result = await AuthService.disconnect(req.user.id);
    return res.status(200).json({
      success: true,
      message: 'LinkedIn account disconnected successfully',
      ...result,
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to disconnect account',
    });
  }
};
