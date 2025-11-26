import { sapphireRpcClient } from '@clients/sapphireRpcClient';
import { AppConfig } from '@config';
import { ApplicationError } from '@lib/errors';

export interface GasEstimateInput {
  from: string;
  to: string;
  data: string;
  value?: string;
}

export interface GasEstimateResult {
  gasLimit: bigint;
  feeCap: bigint;
}

const GAS_BUFFER_MULTIPLIER = 1.2;

export const estimateGasWithFeeGuard = async (
  input: GasEstimateInput
): Promise<GasEstimateResult> => {
  const estimate = await sapphireRpcClient.call<string>('eth_estimateGas', [
    {
      from: input.from,
      to: input.to,
      data: input.data,
      value: input.value ?? '0x0'
    }
  ]);

  const estimatedGas = BigInt(estimate);
  const bufferedGas = BigInt(Math.ceil(Number(estimatedGas) * GAS_BUFFER_MULTIPLIER));

  if (bufferedGas > BigInt(AppConfig.sapphire.maxFeeCeiling)) {
    throw new ApplicationError('Estimated gas exceeds configured ceiling', {
      statusCode: 400,
      code: 'gas_ceiling_exceeded',
      details: {
        estimatedGas: bufferedGas.toString(),
        ceiling: AppConfig.sapphire.maxFeeCeiling
      }
    });
  }

  return {
    gasLimit: bufferedGas,
    feeCap: BigInt(AppConfig.sapphire.maxFeeCeiling)
  };
};
