import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type StrategyOptions,
} from 'passport-google-oauth20';
import { GoogleIdentityService } from './google-identity.service.js';
import { GoogleOAuthStateStore } from './google-oauth-state.store.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    stateStore: GoogleOAuthStateStore,
    private readonly identities: GoogleIdentityService,
  ) {
    const options: StrategyOptions = {
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['openid', 'email'],
      state: true,
      store: stateStore,
      passReqToCallback: false,
    };
    super(options);
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): Promise<string> {
    // The strategy fetched Google's UserInfo response. Never retain provider
    // access/refresh tokens or treat email as the provider's stable identifier.
    const claims: Record<string, unknown> = profile._json;
    if (claims.sub !== profile.id) {
      throw new UnauthorizedException('Google authentication failed');
    }
    return this.identities.findOrCreateUser({
      subject: profile.id,
      email: typeof claims.email === 'string' ? claims.email : '',
      emailVerified: claims.email_verified === true,
    });
  }
}
