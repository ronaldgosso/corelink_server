import { supabaseAdmin } from '../config/supabase.js';
import { decrypt } from '../utils/crypto.js';
import { LinkedInService } from '../services/linkedin.service.js';

/**
 * Handles media upload (images/videos) to LinkedIn via REST API
 * Supports Base64 encoded payload with LinkedIn conditions validation
 */
export const handleUploadMedia = async (req, res) => {
  try {
    const { fileBase64, mediaType, mimeType, fileName, fileSizeBytes } = req.body;

    if (!fileBase64) {
      return res.status(400).json({
        success: false,
        error: 'fileBase64 is required in request body.',
      });
    }

    const type = (mediaType || 'image').toLowerCase();
    if (type !== 'image' && type !== 'video') {
      return res.status(400).json({
        success: false,
        error: 'Invalid mediaType. Allowed values are "image" or "video".',
      });
    }

    // Convert Base64 data (strip data URI prefix if present)
    const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const sizeInBytes = buffer.length;

    // Validate LinkedIn Media Conditions
    if (type === 'image') {
      const maxImageSize = 10 * 1024 * 1024; // 10MB
      if (sizeInBytes > maxImageSize) {
        return res.status(400).json({
          success: false,
          error: `Image exceeds maximum allowed size of 10 MB (received ${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB).`,
        });
      }
    } else if (type === 'video') {
      const minVideoSize = 75 * 1024; // 75KB
      const maxVideoSize = 200 * 1024 * 1024; // 200MB
      if (sizeInBytes < minVideoSize) {
        return res.status(400).json({
          success: false,
          error: `Video is too small. Minimum required size for LinkedIn video is 75 KB (received ${(sizeInBytes / 1024).toFixed(2)} KB).`,
        });
      }
      if (sizeInBytes > maxVideoSize) {
        return res.status(400).json({
          success: false,
          error: `Video exceeds maximum allowed size of 200 MB (received ${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB).`,
        });
      }
    }

    // 1. Fetch user's profile and encrypted LinkedIn token
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found.',
      });
    }

    if (!profile.encrypted_access_token || profile.encrypted_access_token === 'DISCONNECTED') {
      return res.status(400).json({
        success: false,
        error: 'LinkedIn account is not connected. Please connect your LinkedIn account first.',
      });
    }

    // 2. Decrypt access token
    let accessToken;
    try {
      accessToken = decrypt(profile.encrypted_access_token);
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: `Failed to decrypt LinkedIn token: ${err.message}`,
      });
    }

    // 3. Upload to LinkedIn according to media type
    let uploadResult;
    if (type === 'image') {
      uploadResult = await LinkedInService.uploadImageToLinkedIn({
        accessToken,
        personId: profile.linkedin_member_id,
        buffer,
        mimeType: mimeType || 'image/jpeg',
      });
    } else {
      uploadResult = await LinkedInService.uploadVideoToLinkedIn({
        accessToken,
        personId: profile.linkedin_member_id,
        buffer,
        mimeType: mimeType || 'video/mp4',
        fileSizeBytes: sizeInBytes,
      });
    }

    return res.status(200).json({
      success: true,
      message: `${type === 'image' ? 'Image' : 'Video'} uploaded and registered with LinkedIn successfully`,
      mediaAssetUrn: uploadResult.mediaAssetUrn,
      mediaType: uploadResult.mediaType,
      fileSizeBytes: sizeInBytes,
      fileName: fileName || `${type}_${Date.now()}`,
    });
  } catch (error) {
    console.error('Media upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Media upload failed',
    });
  }
};
