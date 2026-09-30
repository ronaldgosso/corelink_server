import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { encrypt } from '../utils/crypto.js';




export class AuthService {
  /**
   * Exchanges authorization code with LinkedIn, fetches user claims,
   * encrypts credentials with AES-256-GCM, and upserts user in Supabase.
   */
  static async exchangeLinkedInCode({ code, redirectUri }) {
    if (!code) {
      throw new Error('Authorization code is required.');
    }

    const clientId = config.linkedin.clientId;
    const clientSecret = config.linkedin.clientSecret;
    const resolvedRedirectUri = redirectUri || config.linkedin.redirectUri;

    if (!clientId || !clientSecret) {
      throw new Error('LinkedIn client credentials are not configured on server.');
    }

    // 1. Exchange code for access token with LinkedIn
    const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: resolvedRedirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      const msg = errorData.error_description || errorData.error || 'Failed to exchange LinkedIn code';
      throw new Error(`LinkedIn OAuth Error: ${msg}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 5184000; // ~60 days default
    const refreshToken = tokenData.refresh_token || null;
    const refreshTokenExpiresIn = tokenData.refresh_token_expires_in || null;

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const refreshTokenExpiresAt = refreshTokenExpiresIn
      ? new Date(Date.now() + refreshTokenExpiresIn * 1000).toISOString()
      : null;

    // 2. Fetch User Profile Info via OpenID UserInfo Endpoint
    const userinfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userinfoResponse.ok) {
      const errText = await userinfoResponse.text();
      throw new Error(`Failed to fetch LinkedIn user profile: ${errText}`);
    }

    const userinfo = await userinfoResponse.json();
    const linkedinMemberId = userinfo.sub;
    const name = userinfo.name || `${userinfo.given_name || ''} ${userinfo.family_name || ''}`.trim() || 'LinkedIn User';
    const email = userinfo.email || null;
    const pictureUrl = userinfo.picture || null;

    // 3. Encrypt sensitive tokens with AES-256-GCM
    const encryptedAccessToken = encrypt(accessToken);
    const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : null;

    // 4. Check if profile already exists in Supabase
    const { data: existingProfile, error: queryError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('linkedin_member_id', linkedinMemberId)
      .maybeSingle();

    if (queryError) {
      console.error('Supabase profile query error:', queryError);
    }

    let profileId;

    if (existingProfile) {
      profileId = existingProfile.id;
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          name,
          email,
          picture_url: pictureUrl,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
          refresh_token_expires_at: refreshTokenExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profileId);

      if (updateError) {
        console.error('Supabase profile update error:', updateError);
        throw new Error(`Failed to update profile: ${updateError.message}`);
      }
    } else {
      // 4b. Ensure user exists in Supabase auth.users to satisfy foreign key constraint
      const authEmail = email || `user_${linkedinMemberId}@corelink.app`;
      let authUserId;

      const { data: newAuthUser, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        email_confirm: true,
        user_metadata: {
          name,
          picture_url: pictureUrl,
          linkedin_member_id: linkedinMemberId,
        },
      });

      if (!authCreateError && newAuthUser?.user?.id) {
        authUserId = newAuthUser.user.id;
      } else {
  // If auth user already existed with this email, fetch the ID
  const { data: userList, error: listUsersError } =
    await supabaseAdmin.auth.admin.listUsers();

  if (listUsersError) {
    throw new Error(
      `Failed to find existing Supabase Auth user: ${listUsersError.message}`
    );
  }

  const existing = userList?.users?.find(
    (u) => u.email?.toLowerCase() === authEmail.toLowerCase()
  );

  if (existing?.id) {
    authUserId = existing.id;
  } else {
    throw new Error(
      `Failed to create or find Supabase Auth user: ${
        authCreateError?.message || 'Unknown error'
      }`
    );
  }
}

      profileId = authUserId;

      const { error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authUserId,
          linkedin_member_id: linkedinMemberId,
          name,
          email,
          picture_url: pictureUrl,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
          refresh_token_expires_at: refreshTokenExpiresAt,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('Supabase profile insert error:', insertError);
        throw new Error(`Failed to create profile: ${insertError.message}`);
      }
    }

    // 5. Generate secure CoreLink application session JWT
    const jwtPayload = {
      userId: profileId,
      linkedinMemberId,
      name,
      email,
    };

    const sessionToken = jwt.sign(jwtPayload, config.security.jwtSecret, {
      expiresIn: '30d',
    });

    return {
      token: sessionToken,
      profile: {
        id: profileId,
        name,
        email,
        pictureUrl,
        linkedinMemberId,
        tokenExpiresAt,
      },
    };
  }

  /**
   * Retrieves profile for the authenticated user from Supabase
   */
  static async getProfile(userId) {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, name, email, picture_url, linkedin_member_id, token_expires_at, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new Error('Profile not found.');
    }

    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      pictureUrl: profile.picture_url,
      linkedinMemberId: profile.linkedin_member_id,
      tokenExpiresAt: profile.token_expires_at,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
      connected: !!profile.token_expires_at && new Date(profile.token_expires_at) > new Date(),
    };
  }

  /**
   * Clears tokens and disconnects LinkedIn account
   */
  static async disconnect(userId) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        encrypted_access_token: 'DISCONNECTED',
        encrypted_refresh_token: null,
        token_expires_at: new Date(0).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to disconnect LinkedIn: ${error.message}`);
    }

    return { success: true };
  }

  /**
   * Generates a developer/test session for local React web app testing.
   * Attaches to an existing profile in DB or creates a dedicated dev profile.
   */
  static async devLogin({ userId = null, email = null } = {}) {
    let targetProfile = null;

    // 1. If explicit userId provided, fetch it
    if (userId) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      targetProfile = data;
    }

    // 2. If explicit email provided, fetch it
    if (!targetProfile && email) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      targetProfile = data;
    }

    // 3. Otherwise, use the latest profile in the database
    if (!targetProfile) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      targetProfile = data;
    }

    // 4. If no profiles exist, create a developer test profile
    if (!targetProfile) {
      const devUserId = '00000000-0000-0000-0000-000000000001';
      const devMemberId = 'dev_corelink_test_user';
      const now = new Date();
      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      const { data: inserted, error } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: devUserId,
          linkedin_member_id: devMemberId,
          name: 'CoreLink Web Developer',
          email: 'developer@corelink.app',
          picture_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
          encrypted_access_token: encrypt('mock_access_token_for_dev_mode'),
          token_expires_at: expiresAt,
          updated_at: now.toISOString(),
        })
        .select()
        .single();

      if (!error && inserted) {
        targetProfile = inserted;
      } else {
        targetProfile = {
          id: devUserId,
          linkedin_member_id: devMemberId,
          name: 'CoreLink Web Developer',
          email: 'developer@corelink.app',
          picture_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
          token_expires_at: expiresAt,
        };
      }
    }

    // 5. Generate signed JWT session token
    const jwtPayload = {
      userId: targetProfile.id,
      linkedinMemberId: targetProfile.linkedin_member_id,
      name: targetProfile.name,
      email: targetProfile.email,
      isDev: true,
    };

    const token = jwt.sign(jwtPayload, config.security.jwtSecret, {
      expiresIn: '30d',
    });

    return {
      token,
      profile: {
        id: targetProfile.id,
        name: targetProfile.name,
        email: targetProfile.email,
        pictureUrl: targetProfile.picture_url,
        linkedinMemberId: targetProfile.linkedin_member_id,
        tokenExpiresAt: targetProfile.token_expires_at,
        connected: true,
      },
    };
  }
}
