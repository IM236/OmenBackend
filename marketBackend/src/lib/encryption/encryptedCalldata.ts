import { TextEncoder } from 'util';

import { getSapphireRuntime } from '@infra/sapphire/provider';

const encoder = new TextEncoder();

export const encryptCalldata = async (
  calldata: Uint8Array | string
): Promise<Uint8Array> => {
  const runtime = getSapphireRuntime();
  void runtime;

  // TODO: Implement Sapphire confidential calldata encryption.
  if (typeof calldata === 'string') {
    return encoder.encode(calldata);
  }

  return calldata;
};
