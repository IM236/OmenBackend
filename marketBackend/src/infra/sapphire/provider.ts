import { JsonRpcProvider, Wallet } from 'ethers';
import { wrap as wrapEthersSigner } from '@oasisprotocol/sapphire-ethers-v6';

import { AppConfig } from '@config';
import { logger } from '@infra/logging/logger';

export interface SapphireRuntimeContext {
  provider: JsonRpcProvider;
  signer: Wallet;
}

let runtimeContext: SapphireRuntimeContext | null = null;

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
  const provider = new JsonRpcProvider(AppConfig.sapphire.rpcUrl, {
    chainId: AppConfig.sapphire.chainId,
    name: 'sapphire'
  });

  // Create wallet from private key or mnemonic
  let wallet: Wallet;
  if (AppConfig.sapphire.mnemonic && AppConfig.sapphire.mnemonic.length > 0) {
    wallet = Wallet.fromPhrase(AppConfig.sapphire.mnemonic);
  } else if (AppConfig.sapphire.privateKey) {
    wallet = new Wallet(AppConfig.sapphire.privateKey);
  } else {
    throw new Error('No private key or mnemonic configured for Sapphire');
  }

  // Connect wallet to provider and wrap with Sapphire encryption
  const signer = wrapEthersSigner(wallet.connect(provider));

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
