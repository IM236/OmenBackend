import { ethers } from 'ethers';
import { ApplicationError } from '@lib/errors';
import { OrderSide, OrderType } from '@app-types/trading';

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract?: string;
}

export interface TypedDataField {
  name: string;
  type: string;
}

export interface OrderSignatureData {
  marketId: string;
  side: OrderSide;
  orderKind: OrderType;
  quantity: string;
  price: string | null;
  nonce: string;
  expiry: number;
}

export interface DepositSignatureData {
  userId: string;
  tokenId: string;
  amount: string;
  nonce: string;
  expiry: number;
}

export interface WithdrawalSignatureData {
  userId: string;
  tokenId: string;
  amount: string;
  destinationAddress: string;
  nonce: string;
  expiry: number;
}

export class EIP712Verifier {
  private readonly domain: EIP712Domain;

  constructor(domain: EIP712Domain) {
    this.domain = domain;
  }

  /**
   * Verify order placement signature
   */
  async verifyOrderSignature(
    data: OrderSignatureData,
    signature: string,
    expectedSigner: string
  ): Promise<boolean> {
    const types = {
      Order: [
        { name: 'marketId', type: 'string' },
        { name: 'side', type: 'string' },
        { name: 'orderKind', type: 'string' },
        { name: 'quantity', type: 'string' },
        { name: 'price', type: 'string' },
        { name: 'nonce', type: 'string' },
        { name: 'expiry', type: 'uint256' }
      ]
    };

    const message = {
      marketId: data.marketId,
      side: data.side,
      orderKind: data.orderKind,
      quantity: data.quantity,
      price: data.price || '',
      nonce: data.nonce,
      expiry: data.expiry
    };

    return this.verify(types, message, signature, expectedSigner);
  }

  /**
   * Verify deposit signature
   */
  async verifyDepositSignature(
    data: DepositSignatureData,
    signature: string,
    expectedSigner: string
  ): Promise<boolean> {
    const types = {
      Deposit: [
        { name: 'userId', type: 'string' },
        { name: 'tokenId', type: 'string' },
        { name: 'amount', type: 'string' },
        { name: 'nonce', type: 'string' },
        { name: 'expiry', type: 'uint256' }
      ]
    };

    const message = {
      userId: data.userId,
      tokenId: data.tokenId,
      amount: data.amount,
      nonce: data.nonce,
      expiry: data.expiry
    };

    return this.verify(types, message, signature, expectedSigner);
  }

  /**
   * Verify withdrawal signature
   */
  async verifyWithdrawalSignature(
    data: WithdrawalSignatureData,
    signature: string,
    expectedSigner: string
  ): Promise<boolean> {
    const types = {
      Withdrawal: [
        { name: 'userId', type: 'string' },
        { name: 'tokenId', type: 'string' },
        { name: 'amount', type: 'string' },
        { name: 'destinationAddress', type: 'address' },
        { name: 'nonce', type: 'string' },
        { name: 'expiry', type: 'uint256' }
      ]
    };

    const message = {
      userId: data.userId,
      tokenId: data.tokenId,
      amount: data.amount,
      destinationAddress: data.destinationAddress,
      nonce: data.nonce,
      expiry: data.expiry
    };

    return this.verify(types, message, signature, expectedSigner);
  }

  /**
   * Core verification logic
   */
  private async verify(
    types: Record<string, TypedDataField[]>,
    message: Record<string, any>,
    signature: string,
    expectedSigner: string
  ): Promise<boolean> {
    try {
      const recoveredAddress = ethers.verifyTypedData(
        this.domain,
        types,
        message,
        signature
      );

      return recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate signature expiry
   */
  validateExpiry(expiry: number): void {
    const now = Math.floor(Date.now() / 1000);
    if (expiry <= now) {
      throw new ApplicationError('Signature has expired', {
        statusCode: 400,
        code: 'signature_expired',
        details: { expiry, now }
      });
    }
  }
}

/**
 * Nonce management for replay protection
 */
export class NonceManager {
  private usedNonces: Set<string> = new Set();

  /**
   * Check if nonce has been used
   */
  isNonceUsed(userAddress: string, nonce: string): boolean {
    const key = `${userAddress}:${nonce}`;
    return this.usedNonces.has(key);
  }

  /**
   * Mark nonce as used
   */
  markNonceAsUsed(userAddress: string, nonce: string): void {
    const key = `${userAddress}:${nonce}`;
    this.usedNonces.add(key);
  }

  /**
   * Clear old nonces (for cleanup)
   */
  clearNonces(): void {
    this.usedNonces.clear();
  }
}

export const createEIP712Verifier = (chainId: number, contractAddress?: string): EIP712Verifier => {
  const domain: EIP712Domain = {
    name: 'OmenMarketBackend',
    version: '1',
    chainId,
    ...(contractAddress && { verifyingContract: contractAddress })
  };

  return new EIP712Verifier(domain);
};
