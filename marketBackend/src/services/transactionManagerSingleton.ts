import { TransactionManager } from '@services/transactionManager';

let instance: TransactionManager | null = null;

export const getTransactionManager = (): TransactionManager => {
  if (!instance) {
    instance = new TransactionManager();
  }

  return instance;
};

export const startTransactionManager = async (): Promise<void> => {
  await getTransactionManager().start();
};

export const stopTransactionManager = async (): Promise<void> => {
  if (!instance) {
    return;
  }

  await instance.stop();
  instance = null;
};
