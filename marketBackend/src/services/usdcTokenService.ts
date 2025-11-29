import { logger } from '@infra/logging/logger';
import { findTokenBySymbol, createToken } from '@infra/database/repositories/tokenRepository';
import { Token } from '@app-types/token';

const USDC_TOKEN_SYMBOL = 'USDC';
const USDC_TOKEN_NAME = 'USD Coin';

/**
 * USDC Token Service
 * Ensures USDC token exists in the system for trading pairs
 */
export class UsdcTokenService {
  private usdcToken: Token | null = null;

  /**
   * Get or create USDC token
   */
  async getOrCreateUsdcToken(): Promise<Token> {
    if (this.usdcToken) {
      return this.usdcToken;
    }

    // Try to find existing USDC token
    let token = await findTokenBySymbol(USDC_TOKEN_SYMBOL);

    if (!token) {
      logger.info('USDC token not found, creating it');

      // Create USDC token
      token = await createToken({
        tokenSymbol: USDC_TOKEN_SYMBOL,
        tokenName: USDC_TOKEN_NAME,
        tokenType: 'STABLE',
        blockchain: 'sapphire',
        decimals: 6,
        metadata: {
          description: 'USD Coin - Stable coin pegged to USD',
          isQuoteToken: true,
          createdBy: 'system'
        }
      });

      logger.info({ tokenId: token.id }, 'USDC token created');
    }

    this.usdcToken = token;
    return token;
  }

  /**
   * Get USDC token ID (throws if not exists)
   */
  async getUsdcTokenId(): Promise<string> {
    const token = await this.getOrCreateUsdcToken();
    return token.id;
  }

  /**
   * Check if a token is USDC
   */
  isUsdcToken(tokenId: string): boolean {
    return this.usdcToken?.id === tokenId;
  }
}

export const usdcTokenService = new UsdcTokenService();
