import { HDNodeWallet, JsonRpcProvider, Wallet } from 'ethers';
// import { wrap as wrapEthersSigner } from '@oasisprotocol/sapphire-ethers-v6';

import { AppConfig } from '@config';
import { logger } from '@infra/logging/logger';

export interface SapphireRuntimeContext {
  provider: JsonRpcProvider;
  signer: Wallet | HDNodeWallet;
}

let runtimeContext: SapphireRuntimeContext | null = null;

const mockWrapEthersSigner = <T extends Wallet | HDNodeWallet>(ethersSigner: T): T => {
  logger.warn('Sapphire signer wrapper is mocked; confidential encryption disabled');
  return ethersSigner;
};

const DEFAULT_DEV_MNEMONIC =
  'test walk nut penalty hip pave soap entry language right filter choice';

export const initializeSapphire = async (): Promise<void> => {
  if (runtimeContext) {
    return;
  }

  logger.info(
    {
      rpcUrl: AppConfig.sapphire.rpcUrl,
      chainId: AppConfig.sapphire.chainId
    },
    'Initialising Sapphire runtime context'
  );

  // Create provider for Sapphire network
  const chainId = Number(AppConfig.sapphire.chainId);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid Sapphire chainId: ${AppConfig.sapphire.chainId}`);
  }

  const provider = new JsonRpcProvider(AppConfig.sapphire.rpcUrl, {
    chainId,
    name: 'sapphire'
  });

  // Create wallet from private key or mnemonic
  const createMockSigner = (reason: string, error?: unknown): Wallet => {
    const mockSigner = Wallet.fromPhrase(DEFAULT_DEV_MNEMONIC).connect(provider);
    logger.warn(
      { reason, address: mockSigner.address, err: error },
      'Using mock Sapphire signer for development'
    );
    return mockSigner;
  };

  let baseSigner: Wallet;
  const mnemonic = AppConfig.sapphire.mnemonic?.trim();
  if (mnemonic) {
    try {
      baseSigner = Wallet.fromPhrase(mnemonic).connect(provider);
    } catch (error) {
      baseSigner = createMockSigner('invalid mnemonic', error);
    }
  } else if (AppConfig.sapphire.privateKey) {
    try {
      baseSigner = new Wallet(AppConfig.sapphire.privateKey, provider);
    } catch (error) {
      baseSigner = createMockSigner('invalid private key', error);
    }
  } else {
    baseSigner = createMockSigner('missing credentials');
  }

  // Connect wallet to provider and wrap with Sapphire encryption (mocked until Sapphire is enabled)
  const signer = mockWrapEthersSigner(baseSigner);

  runtimeContext = {
    provider,
    signer
  };
};

export const getSapphireRuntime = (): SapphireRuntimeContext => {
  if (!runtimeContext) {
    throw new Error('Sapphire runtime context not initialised.');
  }

  return runtimeContext;
};

export const shutdownSapphire = async (): Promise<void> => {
  runtimeContext = null;
  logger.info('Sapphire runtime context released');
};
