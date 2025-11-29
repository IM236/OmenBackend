import { ethers } from 'ethers';
import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import { AppConfig } from '@config';

const requireContractFunction = <T extends (...args: any[]) => any>(
  contract: ethers.Contract,
  functionName: string
): T => {
  const fn = (contract as Record<string, unknown>)[functionName];
  if (typeof fn !== 'function') {
    throw new Error(`Token contract is missing required function "${functionName}"`);
  }
  return fn.bind(contract) as T;
};

export interface MintTokenOnChainParams {
  tokenAddress: string;
  recipient: string;
  amount: string;
  signerPrivateKey: string;
}

export interface TransferTokenOnChainParams {
  tokenAddress: string;
  from: string;
  to: string;
  amount: string;
  signerPrivateKey: string;
}

export interface TokenBalanceParams {
  tokenAddress: string;
  owner: string;
}

export interface DeployTokenParams {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  signerPrivateKey: string;
}

export interface SwapTokensParams {
  sourceTokenAddress: string;
  targetTokenAddress: string;
  amount: string;
  recipient: string;
  bridgeContractAddress: string;
  targetChainId: string;
  signerPrivateKey: string;
  minTargetAmount?: string;
}

export class SapphireTokenClient {
  private provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async mintToken(params: MintTokenOnChainParams): Promise<string> {
    try {
      const wallet = new ethers.Wallet(params.signerPrivateKey, this.provider);

      const tokenAbi = [
        'function mint(address to, uint256 amount) public returns (bool)',
        'function balanceOf(address owner) view returns (uint256)'
      ];

      const tokenContract = new ethers.Contract(params.tokenAddress, tokenAbi, wallet);
      const mint = requireContractFunction<
        (to: string, amount: ethers.BigNumberish) => Promise<ethers.ContractTransactionResponse>
      >(tokenContract, 'mint');

      const tx = await mint(params.recipient, params.amount);
      const receipt = await tx.wait();

      logger.info(
        { txHash: receipt?.hash, tokenAddress: params.tokenAddress, recipient: params.recipient },
        'Token minted on-chain'
      );

      return receipt.hash;
    } catch (error) {
      logger.error({ error, params }, 'Failed to mint token on-chain');
      throw new ApplicationError('Blockchain mint failed', {
        statusCode: 500,
        code: 'blockchain_mint_failed',
        details: { error: String(error) }
      });
    }
  }

  async transferToken(params: TransferTokenOnChainParams): Promise<string> {
    try {
      const wallet = new ethers.Wallet(params.signerPrivateKey, this.provider);

      const tokenAbi = [
        'function transfer(address to, uint256 amount) public returns (bool)',
        'function transferFrom(address from, address to, uint256 amount) public returns (bool)'
      ];

      const tokenContract = new ethers.Contract(params.tokenAddress, tokenAbi, wallet);
      const transfer = requireContractFunction<
        (to: string, amount: ethers.BigNumberish) => Promise<ethers.ContractTransactionResponse>
      >(tokenContract, 'transfer');

      const tx = await transfer(params.to, params.amount);
      const receipt = await tx.wait();

      logger.info(
        { txHash: receipt.hash, tokenAddress: params.tokenAddress, to: params.to },
        'Token transferred on-chain'
      );

      return receipt.hash;
    } catch (error) {
      logger.error({ error, params }, 'Failed to transfer token on-chain');
      throw new ApplicationError('Blockchain transfer failed', {
        statusCode: 500,
        code: 'blockchain_transfer_failed',
        details: { error: String(error) }
      });
    }
  }

  async getTokenBalance(params: TokenBalanceParams): Promise<string> {
    try {
      const tokenAbi = ['function balanceOf(address owner) view returns (uint256)'];

      const tokenContract = new ethers.Contract(params.tokenAddress, tokenAbi, this.provider);
      if (!params.owner) {
        throw new Error('Owner address is required to fetch token balance');
      }
      const balanceOf = requireContractFunction<(owner: string) => Promise<bigint>>(
        tokenContract,
        'balanceOf'
      );
      const balance = await balanceOf(params.owner);

      return balance.toString();
    } catch (error) {
      logger.error({ error, params }, 'Failed to get token balance');
      throw new ApplicationError('Failed to fetch balance', {
        statusCode: 500,
        code: 'balance_fetch_failed',
        details: { error: String(error) }
      });
    }
  }

  async deployToken(params: DeployTokenParams): Promise<{ address: string; txHash: string }> {
    try {
      const wallet = new ethers.Wallet(params.signerPrivateKey, this.provider);

      const tokenBytecode = '0x'; // Placeholder - should be actual ERC20 bytecode
      const tokenAbi = [
        'constructor(string name, string symbol, uint8 decimals, uint256 initialSupply)'
      ];

      const factory = new ethers.ContractFactory(tokenAbi, tokenBytecode, wallet);

      const contract = await factory.deploy(
        params.name,
        params.symbol,
        params.decimals,
        params.initialSupply
      );

      await contract.waitForDeployment();
      const address = await contract.getAddress();
      const deployTx = contract.deploymentTransaction();

      logger.info(
        { address, symbol: params.symbol },
        'Token contract deployed'
      );

      return {
        address,
        txHash: deployTx?.hash || ''
      };
    } catch (error) {
      logger.error({ error, params }, 'Failed to deploy token contract');
      throw new ApplicationError('Token deployment failed', {
        statusCode: 500,
        code: 'token_deployment_failed',
        details: { error: String(error) }
      });
    }
  }

  async getTransactionReceipt(txHash: string): Promise<ethers.TransactionReceipt | null> {
    try {
      return await this.provider.getTransactionReceipt(txHash);
    } catch (error) {
      logger.error({ error, txHash }, 'Failed to get transaction receipt');
      return null;
    }
  }

  async getCurrentBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getBlockTimestamp(blockNumber: number): Promise<number> {
    const block = await this.provider.getBlock(blockNumber);
    return block?.timestamp || 0;
  }

  async swapTokens(params: SwapTokensParams): Promise<{ swapId: string; txHash: string }> {
    try {
      const wallet = new ethers.Wallet(params.signerPrivateKey, this.provider);
      const bridgeAbi = [
        'function swap(address sourceToken,address targetToken,uint256 amount,address recipient,string targetChain,uint256 minTargetAmount) returns (bytes32)',
        'event SwapInitiated(bytes32 indexed swapId,address indexed user,address sourceToken,address targetToken,uint256 amount,string targetChain,uint256 minTargetAmount)'
      ];

      const bridgeContract = new ethers.Contract(
        params.bridgeContractAddress,
        bridgeAbi,
        wallet
      );

      const swapFn = requireContractFunction<
        (
          sourceToken: string,
          targetToken: string,
          amount: ethers.BigNumberish,
          recipient: string,
          targetChain: string,
          minTargetAmount: ethers.BigNumberish
        ) => Promise<ethers.ContractTransactionResponse>
      >(bridgeContract, 'swap');

      const minTargetAmount = params.minTargetAmount ?? params.amount;
      const tx = await swapFn(
        params.sourceTokenAddress,
        params.targetTokenAddress,
        params.amount,
        params.recipient,
        params.targetChainId,
        minTargetAmount
      );
      const receipt = await tx.wait();

      let swapId: string | null = null;
      if (receipt && receipt.logs?.length) {
        for (const log of receipt.logs) {
          try {
            const parsed = bridgeContract.interface.parseLog(log);
            if (parsed && parsed.name === 'SwapInitiated') {
              swapId = parsed.args.swapId;
              break;
            }
          } catch (parseError) {
            logger.debug({ parseError }, 'Failed to parse swap log');
          }
        }
      }

      const computedSwapId =
        swapId || ethers.id(`${receipt?.hash}:${params.sourceTokenAddress}:${params.amount}`);

      logger.info(
        {
          swapId: computedSwapId,
          txHash: receipt?.hash,
          sourceToken: params.sourceTokenAddress,
          targetToken: params.targetTokenAddress,
          amount: params.amount,
          targetChain: params.targetChainId
        },
        'Swap initiated on Sapphire bridge'
      );

      return {
        swapId: computedSwapId,
        txHash: receipt?.hash || ''
      };
    } catch (error) {
      logger.error({ error, params }, 'Failed to execute Sapphire token swap');
      throw new ApplicationError('Sapphire swap failed', {
        statusCode: 500,
        code: 'sapphire_swap_failed',
        details: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  }
}

let sapphireTokenClient: SapphireTokenClient | null = null;

export const initializeSapphireTokenClient = (): SapphireTokenClient => {
  if (!sapphireTokenClient) {
    sapphireTokenClient = new SapphireTokenClient(AppConfig.sapphire.rpcUrl);
    logger.info('Sapphire token client initialized');
  }
  return sapphireTokenClient;
};

export const getSapphireTokenClient = (): SapphireTokenClient => {
  if (!sapphireTokenClient) {
    throw new Error('Sapphire token client not initialized');
  }
  return sapphireTokenClient;
};
